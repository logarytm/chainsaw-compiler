const R = require('ramda');
const { Scope } = require('./scope.js');
const { Register, Absolute, Relative, Immediate, Label } = require('./assembly.js');
const { CompileError, showCompileError, showLocation, inspect } = require('./utility.js');
const { registers, RegisterAllocator } = require('./register.js');
const { getReservationSize, createCallingConvention } = require('./abi.js');

const VARIABLE = Symbol('variable');
const FUNCTION = Symbol('function');

function generateCode(topLevelStatements, writer, metadata) {
    const result = { success: true };
    const stack = [];
    const rootScope = new Scope();

    function generateFunctionDeclinition(declinition, state) {
        checkNodeKind(declinition, ['FunctionDefinition', 'FunctionDeclaration']);

        const isDefinition = declinition.kind === 'FunctionDefinition';
        const functionName = declinition.functionName;
        const label = writer.prepareLabel(functionName);
        state.scope.bind(functionName, {
            label,
            nature: FUNCTION,
            arity: declinition.parameters.length,
            parameters: declinition.parameters,
            returnType: declinition.returnType,
            hasReturnValue: !isVoidType(declinition.returnType),
            callingConvention: createCallingConvention(declinition.callingConvention),
        }, redefinition(functionName));

        if (!isDefinition) {
            return;
        }

        const parameterBindings = {};
        for (const parameter of declinition.parameters) {
            parameterBindings[parameter.name] = {
                label: writer.reserve(functionName + '.P' + parameter.name),
                name: parameter.name,
            };
        }

        writer.label(label);

        trace('function-prologue', 'start', functionName);
        if (declinition.parameters.length) {
            let descent = 0;
            declinition.parameters.forEach(parameter => {
                descent++;
                writer.opcode('add', new Register('sp'), new Immediate(1));
                writer.mov(parameterBindings[parameter.name].label, new Relative(new Register('sp')));
            });
            writer.opcode('sub', new Register('sp'), new Immediate(descent));
        }
        trace('function-prologue', 'end', functionName);

        declinition.body.statements.forEach(statement => generateStatement(statement, state.extend({
            scope: state.scope.extend(parameterBindings),
            prefix: `${state.prefix}${functionName}.`,
        })));

        writer.ret();
    }

    function generateVariableDeclaration(declaration, state) {
        const variableName = declaration.variableName;
        const label = writer.reserve(state.prefix + 'V' + variableName, getReservationSize(declaration.variableType));

        state.scope.bind(variableName, {
            label,
            type: declaration.variableType,
            nature: VARIABLE,
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
                if (application.function.kind !== 'Identifier') {
                    throw new Error(`Calling expressions as functions is not implemented.`);
                }

                const functionName = application.function.name;
                const declaration = state.scope.lookup(functionName, () => {
                    fatal(`${functionName} is not defined.`);
                });

                check(
                    application.args.length === declaration.arity,
                    `Wrong number of arguments to ${functionName} (expected ${declaration.arity}, got ${application.args.length}).`,
                );

                declaration.callingConvention.emitCall(declaration, application.args, state.extend({
                    computeExpressionIntoRegister: computeExpression,
                }));

                writer.opcode('call', new Relative(declaration.label));
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
                    const copyFlag = { '<': 'ccf', '>': 'cof' }[operator.operator];
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

                    state.callWithFreeRegisters(2, (lhsRegister, rhsRegister) => {
                        computeExpression(lhsRegister, operator.lhs, state);
                        computeExpression(rhsRegister, operator.rhs, state);
                        writer.test(lhsRegister, rhsRegister);
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

                    //region Assignment operator
                case '=': {
                    let lhsOperand = null;
                    // TODO: Need to support arrays and pointers.

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
                        '+': 'adc',
                        '-': 'suc',
                        '*': 'Smul6',
                        '/': 'Sdiv6',
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

                writer.mov(destinationRegister, new Relative(state.scope.lookup(name, () => {
                    fatal(`${name} is not defined.`);
                }).label));
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

    topLevelStatements.forEach(descend(generateFunctionDeclinition, statePrototype.extend({
        scope: rootScope,
        prefix: '',
        assemblyWriter: writer,
    })));

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
        console.error(showCompileError(new CompileError(message, top().location)));
        result.success = false;
    }

    function fatal(message) {
        throw new CompileError(message, top().location, metadata.filename);
    }

    function check(condition, message) {
        if (!condition) {
            fatal(message);
        }
    }

    function checkNodeKind(node, kinds, message = `Expected ${kinds.join(' or ')}, got ${node.kind}.`) {
        check(kinds.includes(node.kind), message);
    }

    function redefinition(symbol) {
        return () => error(`redefinition of "${symbol}"`);
    }

    function mandatory() {
        throw new Error('missing argument');
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
            stack.push(node);
            trace('traverse', 'enter', node.kind, showLocation(node.location));

            const result = fn(node, state);

            trace('traverse', 'leave', node.kind, showLocation(node.location));
            stack.pop();

            return result;
        };
    }

    function match(node, mappings) {
        if (!mappings.hasOwnProperty(node.kind)) {
            throw new Error(`match: unhandled node kind ${node.kind}`);
        }

        mappings[node.kind](node);
    }

    //endregion

    return result;
}

exports.generateCode = generateCode;
