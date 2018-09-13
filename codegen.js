const R = require('ramda');
const { Scope } = require('./scope.js');
const { Register, Absolute, Relative, Immediate, Label } = require('./assembly.js');
const { CompileError, showCompileError, showLocation, nodesEqual } = require('./utility.js');
const { registers, RegisterAllocator } = require('./register.js');
const { getReservationSize, createCallingConvention } = require('./abi.js');

/**
 * These values are assigned to names in the scope.  For example, every function declaration has FUNCTION_NATURE, and
 * we can protect from assigning to functions by checking the nature property of a name.
 */
const FUNCTION_NATURE = Symbol('function');
const VARIABLE_NATURE = Symbol('variable');
const PARAMETER_NATURE = Symbol('parameter');

function generateCode(topLevelStatements, writer, metadata) {
    const result = { success: true };
    const stack = [];
    const rootScope = new Scope();

    function generateFunctionDeclinition(declinition, state) {
        checkNodeKind(declinition, ['FunctionDefinition', 'FunctionDeclaration']);

        const isDefinition = declinition.kind === 'FunctionDefinition';
        const functionName = declinition.functionName;
        const label = writer.prepareLabel(functionName);

        /**
         * Create a binding.  The convention is that whenever a name is declared, we store the following information
         * into the scope:
         *
         *   - The label, which can be used to reference the allocated memory or the code being generated;
         *   - Type information, which lets us emit proper calls and check type correctness later on, including
         *   - The binding nature, which informs what the name symbolises (function, variable, named type...)
         */
        const binding = {
            label,
            functionName,
            isDefinition,
            arity: declinition.parameters.length,
            parameters: declinition.parameters,
            returnType: declinition.returnType,
            hasReturnValue: !isVoidType(declinition.returnType),
            callingConvention: createCallingConvention(declinition.callingConvention),
            nature: FUNCTION_NATURE,
        };

        binding.callingConvention.validateDeclaration(binding, state);

        state.scope.bind(functionName, binding, function alreadyBound(previousBinding) {
            // There can never be more than one definition.
            if (previousBinding.isDefinition && binding.isDefinition) {
                fatal(`Redefinition of ${functionName}.`);
            }

            // But there can be multiple declarations.  We check if they have the same parameters and return type.
            const isEquivalent =
                previousBinding.nature === FUNCTION_NATURE
                && nodesEqual(binding.parameters.map(p => p.type), previousBinding.parameters.map(p => p.type))
                && nodesEqual(binding.returnType, previousBinding.returnType);

            check(isEquivalent, `Redeclaration of ${functionName} with different type.`);
        });

        if (!isDefinition) {
            // This is only a declaration, we are done here.
            return;
        }

        const parameterBindings = {};
        for (const parameter of declinition.parameters) {
            check(parameter.type.kind !== 'ArrayType',
                'Cannot pass arrays as arguments. Use a pointer instead.');

            parameterBindings[parameter.name] = {
                label: writer.reserve(functionName + '.P' + parameter.name),
                name: parameter.name,
                type: parameter.type,
                nature: PARAMETER_NATURE,
            };
        }

        writer.label(label);

        trace('function-prologue', 'start', functionName);
        binding.callingConvention.emitPrologue(binding, parameterBindings, state);
        trace('function-prologue', 'end', functionName);

        declinition.body.statements.forEach(statement => generateStatement(statement, state.extend({
            scope: state.scope.extend(parameterBindings),
            prefix: `${state.prefix}${functionName}.`,
        })));

        trace('function-epilogue', 'start', functionName);
        binding.callingConvention.emitEpilogue(binding, parameterBindings, state);
        trace('function-epilogue', 'end', functionName);

        writer.ret();
    }

    function generateVariableDeclaration(declaration, state) {
        const variableName = declaration.variableName;
        const label = writer.reserve(state.prefix + 'V' + variableName, getReservationSize(declaration.variableType));

        state.scope.bind(variableName, {
            label,
            type: declaration.variableType,
            nature: VARIABLE_NATURE,
        });

        if (declaration.initialValue !== null) {
            check(declaration.variableType.kind !== 'ArrayType', 'Cannot initialize arrays at definition time.');

            state.callWithFreeRegister(register => {
                computeExpression(register, declaration.initialValue, state);
                writer.mov(new Relative(label), register);
            });
        }
    }

    function generateStatement(statement, state) {
        match(statement, {
            VariableDeclaration: descend(generateVariableDeclaration, state),
            ConditionalStatement: descend(generateConditionalStatement, state),
            LoopingStatement: descend(generateLoopingStatement, state),
            ReturnStatement: descend(generateReturnStatement, state),
            ExpressionStatement: descend(generateExpressionStatement, state),
        });
    }

    function generateExpressionStatement(statement, state) {
        const expression = statement.expression;
        state.callWithFreeRegister(register => {
            // TODO(optimize): omit calculation if expression has no side effects
            computeExpression(register, expression, state);
        });
    }

    function generateConditionalStatement(statement, state) {
        const elseLabel = writer.prepareLabel();
        const afterLabel = writer.prepareLabel();

        state.callWithFreeRegister(predicateRegister => {
            computeExpression(predicateRegister, statement.predicate, state);

            writer.cmp(predicateRegister, predicateRegister);
            writer.jz(new Relative(elseLabel));

            into(generateBody, statement.thenBranch, state);
            writer.jmp(new Relative(afterLabel));
            writer.label(elseLabel);

            into(generateBody, statement.elseBranch, state);
            writer.label(afterLabel);
        });
    }

    function generateLoopingStatement(statement, state) {
        const start = writer.labelHere();
        const exit = writer.prepareLabel();

        state.callWithFreeRegister(predicateRegister => {
            computeExpression(predicateRegister, statement.predicate, state);

            writer.cmp(predicateRegister, predicateRegister);
            writer.jz(new Relative(exit));

            into(generateBody, statement.body, state);
            writer.jmp(new Relative(start));
            writer.label(exit);
        });
    }

    function generateBody(body, state) {
        body.statements.forEach(statement => generateStatement(statement, state));
    }

    function generateReturnStatement(rs, state) {
        computeExpression(registers.ax, rs.expression, state);
        writer.ret();
    }

    function computeExpression(destinationRegister, expression, state = mandatory()) {
        match(expression, {
            FunctionApplication(application) {
                check(application.function.kind === 'Identifier', `Calling expressions as functions is not implemented.`);

                const functionName = application.function.name;
                const binding = state.scope.lookup(functionName, () => {
                    fatal(`${functionName} is not defined.`);
                });

                check(
                    application.args.length === binding.arity,
                    `Wrong number of arguments to ${functionName} (expected ${binding.arity}, got ${application.args.length}).`,
                );

                binding.callingConvention.emitCall(binding, application.args, state.extend({
                    computeExpressionIntoRegister: computeExpression,
                }));
            },

            ArrayDereference(dereference) {
                state.callWithFreeRegisters(2, (arrayRegister, offsetRegister) => {
                    computeExpression(arrayRegister, dereference.array, state);
                    computeExpression(offsetRegister, dereference.offset, state);

                    writer.opcode('add', arrayRegister, offsetRegister);
                    writer.mov(destinationRegister, new Relative(arrayRegister));
                });
            },

            UnaryOperator(operator) {
                switch (operator.operator) {
                case 'not':
                    state.borrowRegister(destinationRegister, () => {
                        computeExpression(destinationRegister, operator.operand, state);
                        writer.not(destinationRegister);
                    });
                    break;

                default:
                    throw new Error(`Unary operator not implemented: ${operator.operator}.`);
                }
            },

            BinaryOperator(operator) {
                switch (operator.operator) {

                    //region Relational operators
                case '<':
                case '>': {
                    const copyFlag = { '<': 'cff', '>': 'cof' }[operator.operator];

                    state.callWithFreeRegisters(2, (lhsRegister, rhsRegister) => {
                        computeExpression(lhsRegister, operator.lhs, state);
                        computeExpression(rhsRegister, operator.rhs, state);
                        writer.cmp(lhsRegister, rhsRegister);
                        state.borrowRegister(registers.dx, () => {
                            writer.opcode(copyFlag);
                            writer.mov(destinationRegister, registers.dx);
                        });
                    });
                    break;
                }

                case '==':
                case '!=': {
                    const shouldNegate = operator.operator === '!=';

                    state.callWithFreeRegister(rhsRegister => {
                        computeExpression(destinationRegister, operator.lhs, state);
                        computeExpression(rhsRegister, operator.rhs, state);
                        writer.test(destinationRegister, rhsRegister);
                        state.borrowRegister(registers.dx, () => {
                            writer.czf();
                            writer.mov(destinationRegister, registers.dx);
                            if (shouldNegate) {
                                writer.not(destinationRegister);
                            }
                        });
                    });
                    break;
                }
                    //endregion

                    //region Assignment operators
                case '=': {
                    let lhsOperand = null;

                    switch (operator.lhs.kind) {
                    case 'Identifier': {
                        const identifier = operator.lhs;
                        lhsOperand = new Relative(state.scope.lookup(identifier.name, () => {
                            error(`${identifier.name} is not defined`);
                        }).label);
                        break;
                    }

                    default: {
                        throw new Error(`Unimplemented l-value kind: ${operator.lhs.kind}.`);
                    }
                    }

                    state.callWithFreeRegister(rhsRegister => {
                        computeExpression(rhsRegister, operator.rhs, state);
                        writer.mov(lhsOperand, rhsRegister);
                    });
                    break;
                }
                    //endregion

                    //region Arithmetic and bitwise operators
                case '+':
                case '-':
                case '*':
                case '/':
                case '&': {
                    const opcode = {
                        '+': 'add',
                        '-': 'sub',
                        '*': 'sys mul6',
                        '/': 'sys div6',
                        '&': 'and',
                    }[operator.operator];

                    state.callWithFreeRegister(rhsRegister => {
                        computeExpression(destinationRegister, operator.lhs, state);
                        computeExpression(rhsRegister, operator.rhs, state);
                        writer.opcode(opcode, destinationRegister, rhsRegister);
                    });
                    break;
                }
                    //endregion

                default:
                    throw new Error(`Binary operator not implemented: ${operator.operator}.`);
                }
            },

            Identifier({ name }) {
                // Handle pre-defined identifiers.
                switch (name) {
                case 'true': {
                    writer.mov(destinationRegister, new Immediate(1));
                    return;
                }

                case 'false': {
                    writer.mov(destinationRegister, new Immediate(0));
                    return;
                }
                }

                const binding = state.scope.lookup(name, () => {
                    fatal(`${name} is not defined.`);
                });

                check(binding.nature === VARIABLE_NATURE || binding.nature === PARAMETER_NATURE, `${name} is not an l-value.`);
                writer.mov(destinationRegister, new Relative(binding.label));
            },

            Number({ value }) {
                writer.mov(destinationRegister, new Immediate(value));
            },
        });
    }

    // Write traces as comments in assembly output.
    tracing.setTraceHandler(traceHandler);

    const statePrototype = {
        extend(obj) {
            return Object.assign({}, this, obj);
        },

        createError(message) {
            return new CompileError(message, top().location, metadata.filename);
        },

        registerAllocator: new RegisterAllocator(writer),

        callWithFreeRegister(fn) {
            return this.registerAllocator.callWithFreeRegister(fn);
        },

        // Allocates a number of registers to be used at the same time.
        callWithFreeRegisters(count, fn, registers = []) {
            if (count > this.registerAllocator.maxUsed) {
                throw new Error(`Cannot use more than ${this.registerAllocator.maxUsed} registers at the same time.`);
            }

            if (registers.length < count) {
                return this.callWithFreeRegister(register => {
                    return this.callWithFreeRegisters(count, fn, [...registers, register]);
                });
            }

            return fn(...registers);
        },

        borrowRegister(register, fn) {
            return this.registerAllocator.borrowRegister(register, fn);
        },
    };

    const globalState = statePrototype.extend({
        scope: rootScope,
        prefix: '',
        assemblyWriter: writer,
    });

    topLevelStatements.forEach(descend(generateFunctionDeclinition, globalState));

    tracing.restoreTraceHandler();

    //region Types
    function isVoidType(type) {
        return type.kind === 'NamedType' && type.name === 'void';
    }

    //endregion

    //region Tracing
    function traceHandler(family, ...args) {
        writer.comment(`trace(${family}): ${args.join(' ')}`);
    }

    //endregion

    //region Error reporting
    function error(message) {
        console.error(showCompileError(globalState.createError(message)));
        result.success = false;
    }

    /**
     * Reports an unrecoverable error.
     */
    function fatal(message) {
        throw globalState.createError(message);
    }

    function check(condition, message) {
        if (!condition) {
            fatal(message);
        }
    }

    function checkNodeKind(node, kinds, message = `Expected ${kinds.join(' or ')}, got ${node.kind}.`) {
        check(kinds.includes(node.kind), message);
    }

    function mandatory() {
        throw new Error('Missing argument. This is a bug.');
    }

    //endregion

    //region Tree traversal
    function top() {
        return R.last(stack);
    }

    function into(fn, node, state = mandatory()) {
        return descend(fn, state)(node);
    }

    function descend(fn, state = mandatory()) {
        return node => {
            trace('traverse', 'enter', node.kind, showLocation(node.location));
            stack.push(node);

            const result = fn(node, state);

            trace('traverse', 'leave', node.kind, showLocation(node.location));
            stack.pop();

            return result;
        };
    }

    function match(node, mappings) {
        if (!mappings.hasOwnProperty(node.kind)) {
            throw new Error(`match(): Unhandled node kind: ${node.kind}.`);
        }

        mappings[node.kind](node);
    }

    //endregion

    return result;
}

exports.generateCode = generateCode;
