import * as R from 'ramda';
import { CompileError, nodesEqual, showCompileError, showLocation } from './utils';
import { createCallingConvention, getReservationSize } from './abi';
import { AssemblyWriter, Immediate, Register, Relative } from './assembly';
import { RegisterAllocator, registers } from './register';
import { Scope } from './scope';
import { Binding, CodegenState, FUNCTION_NATURE, PARAMETER_NATURE, VARIABLE_NATURE } from './contracts';
import { AnyNode } from './grammar';

declare global {
    const tracing: any;
}

export function generateCode(topLevelStatements, writer: AssemblyWriter, options) {
    const result = { success: true };
    const stack = [];
    const rootScope = new Scope();

    let stringCounter = 0;

    function generateTopLevelStatement(statement, state: CodegenState) {
        switch (statement.kind) {
        case 'FunctionDefinition':
        case 'FunctionDeclaration':
            generateFunctionDeclinition(statement, state);
            break;

        case 'VariableDeclaration':
            generateVariableDeclaration(statement, state);
            break;

        default:
            fatal(`Unexpected top-level node kind: ${statement.kind}.`);
        }
    }

    function generateFunctionDeclinition(declinition, state: CodegenState) {
        checkNodeKind(declinition, ['FunctionDefinition', 'FunctionDeclaration']);

        const isDefinition = declinition.kind === 'FunctionDefinition';
        const functionName = declinition.functionName;
        const label = writer.createLabel(functionName);

        /**
         * Create a binding.  The convention is that whenever a name is declared, we store the following information
         * into the scope:
         *
         *   - The label, which can be used to reference the allocated memory or the code being generated;
         *   - Type information, which lets us emit proper calls and check type correctness later on, including
         *   - The binding nature, which informs what the name symbolises (function, variable, named type...)
         */
        const binding: Binding = {
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

            check(previousBinding.nature === FUNCTION_NATURE, `Redefinition of ${functionName} with different type`);

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

        writer.opcode('ret');
    }

    function generateVariableDeclaration(declaration, state: CodegenState): void {
        const variableName = declaration.variableName;
        const label = writer.reserve(state.prefix + 'V' + variableName, getReservationSize(declaration.variableType));

        state.scope.bind(variableName, {
            label,
            name: variableName,
            type: declaration.variableType,
            nature: VARIABLE_NATURE,
        }, function (binding) {
            error(`Name ${variableName} is already bound.`);
        });

        if (declaration.initialValue !== null) {
            check(declaration.variableType.kind !== 'ArrayType', 'Cannot initialize arrays at definition time.');

            state.callWithFreeRegister(register => {
                computeExpression(register, declaration.initialValue, state);
                writer.opcode('mov', new Relative(label), register);
            });
        }
    }

    function generateStatement(statement, state: CodegenState) {
        match(statement, {
            VariableDeclaration: descend(generateVariableDeclaration, state),
            ConditionalStatement: descend(generateConditionalStatement, state),
            LoopingStatement: descend(generateLoopingStatement, state),
            ReturnStatement: descend(generateReturnStatement, state),
            ExpressionStatement: descend(generateExpressionStatement, state),
            InlineAssembler: descend(generateInlineAssembler, state),
        });
    }

    function generateInlineAssembler(assembler, state) {
        writer.raw(assembler.instructions);
    }

    function generateExpressionStatement(statement, state) {
        const expression = statement.expression;
        state.callWithFreeRegister(register => {

            // TODO(optimize): omit calculation if expression has no side effects
            computeExpression(register, expression, state);
        });
    }

    function generateConditionalStatement(statement, state) {
        const elseLabel = writer.createLabel();
        const afterLabel = writer.createLabel();

        state.callWithFreeRegister(predicateRegister => {
            computeExpression(predicateRegister, statement.predicate, state);

            writer.opcode('cmp', predicateRegister, predicateRegister);
            writer.opcode('jz', new Relative(elseLabel));

            into(generateBody, statement.thenBranch, state);
            writer.opcode('jmp', new Relative(afterLabel));
            writer.label(elseLabel);

            into(generateBody, statement.elseBranch, state);
            writer.label(afterLabel);
        });
    }

    function generateLoopingStatement(statement, state) {
        const start = writer.createAndEmitLabel();
        const exit = writer.createLabel();

        state.callWithFreeRegister(predicateRegister => {
            computeExpression(predicateRegister, statement.predicate, state);

            writer.opcode('cmp', predicateRegister, predicateRegister);
            writer.opcode('jz', new Relative(exit));

            into(generateBody, statement.body, state);
            writer.opcode('jmp', new Relative(start));
            writer.label(exit);
        });
    }

    function generateBody(body, state) {
        body.statements.forEach(statement => generateStatement(statement, state));
    }

    function generateReturnStatement(rs, state) {
        computeExpression(registers.ax, rs.expression, state);
        writer.opcode('ret');
    }

    function computeExpression(destinationRegister, expression, state: CodegenState) {
        match(expression, {
            FunctionApplication(application) {
                check(application.function.kind === 'Identifier', `Calling expressions as functions is not implemented.`);

                const functionName = application.function.name;
                const binding = state.scope.lookup(functionName, (name: string): never => {
                    return fatal(`${functionName} is not defined.`);
                });

                check(binding.nature === FUNCTION_NATURE, `${functionName} is not a function.`);

                check(
                    application.args.length === binding.arity,
                    `Wrong number of arguments to ${functionName} (expected ${binding.arity}, got ${application.args.length}).`,
                );

                // XXX: Not sure if the extend is necessary
                binding.callingConvention.emitCall(binding, application.args, state.extend({}), computeExpression);
            },

            ArrayDereference(dereference) {
                state.callWithFreeRegisters(2, (arrayRegister, offsetRegister) => {
                    computeExpression(arrayRegister, dereference.array, state);
                    computeExpression(offsetRegister, dereference.offset, state);

                    writer.opcode('add', arrayRegister, offsetRegister);
                    writer.opcode('mov', destinationRegister, new Relative(arrayRegister));
                });
            },

            UnaryOperator(operator) {
                switch (operator.operator) {
                case 'not':
                    state.borrowRegister(destinationRegister, () => {
                        computeExpression(destinationRegister, operator.operand, state);
                        writer.opcode('not', destinationRegister);
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
                        writer.opcode('cmp', lhsRegister, rhsRegister);
                        state.borrowRegister(registers.dx, () => {
                            writer.opcode(copyFlag);
                            writer.opcode('mov', destinationRegister, registers.dx);
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
                        writer.opcode('test', destinationRegister, rhsRegister);
                        state.borrowRegister(registers.dx, () => {
                            writer.opcode('czf');
                            writer.opcode('mov', destinationRegister, registers.dx);
                            if (shouldNegate) {
                                writer.opcode('not', destinationRegister);
                            }
                        });
                    });
                    break;
                }

                    //endregion

                    //region Logical operators
                case 'or':
                    state.callWithFreeRegister(rhsRegister => {
                        const exit = writer.createLabel();

                        computeExpression(destinationRegister, operator.lhs, state);
                        writer.opcode('test', destinationRegister, new Immediate(0));
                        writer.opcode('jnz', exit);
                        computeExpression(destinationRegister, operator.rhs, state);
                        writer.label(exit);
                    });
                    break;

                case 'and':
                    state.callWithFreeRegister(rhsRegister => {
                        const exit = writer.createLabel();

                        computeExpression(destinationRegister, operator.lhs, state);
                        writer.opcode('test', destinationRegister, new Immediate(0));
                        writer.opcode('jz', exit);
                        computeExpression(destinationRegister, operator.rhs, state);
                        writer.label(exit);
                    });
                    break;

                    //endregion

                    //region Assignment operators
                case '=': {
                    let lhsOperand = null;

                    switch (operator.lhs.kind) {
                    case 'Identifier': {
                        const identifier = operator.lhs;
                        lhsOperand = new Relative(state.scope.lookup(identifier.name, (name: string): never => {
                            return fatal(`${identifier.name} is not defined`);
                        }).label);
                        break;
                    }

                    default: {
                        throw new Error(`Unimplemented l-value kind: ${operator.lhs.kind}.`);
                    }
                    }

                    state.callWithFreeRegister(rhsRegister => {
                        computeExpression(rhsRegister, operator.rhs, state);
                        writer.opcode('mov', lhsOperand, rhsRegister);
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
                    writer.opcode('mov', destinationRegister, new Immediate(1));
                    return;
                }

                case 'false': {
                    writer.opcode('mov', destinationRegister, new Immediate(0));
                    return;
                }
                }

                const binding = state.scope.lookup(name, () => {
                    fatal(`${name} is not defined.`);
                });

                check(binding.nature === VARIABLE_NATURE || binding.nature === PARAMETER_NATURE, `${name} is not an l-value.`);
                writer.opcode('mov', destinationRegister, new Relative(binding.label));
            },

            Number({ value }) {
                writer.opcode('mov', destinationRegister, new Immediate(value));
            },

            String({ string }) {
                const encoded = [...string].map(c => c.charCodeAt(0));
                const id = 'S' + stringCounter++;
                const label = writer.reserve(id, string.length, [string.length, ...encoded]);

                writer.opcode('lea', destinationRegister, new Relative(label));
            },
        });
    }

    // Write traces as comments in assembly output.
    tracing.setTraceHandler(traceHandler);

    const statePrototype: Partial<CodegenState> = {
        extend(obj: Partial<CodegenState>): CodegenState {
            return Object.assign({}, this, obj);
        },

        createError(message: string): CompileError {
            return new CompileError(message, top().location, options.filename);
        },

        registerAllocator: new RegisterAllocator(writer),

        callWithFreeRegister<T>(fn: (register: Register) => T): T {
            return this.registerAllocator.callWithFreeRegister(fn);
        },

        // Allocates a number of registers to be used at the same time.
        callWithFreeRegisters<T>(count: number, fn: (...registers: Register[]) => T, registers: Register[] = []): T {
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

        borrowRegister<T>(register: Register, fn: () => T) {
            return this.registerAllocator.borrowRegister(register, fn);
        },
    };

    const globalState: CodegenState = statePrototype.extend({
        scope: rootScope,
        prefix: '',
        assemblyWriter: writer,
    });

    topLevelStatements.forEach(descend(generateTopLevelStatement, globalState));

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
    function error(message: string): void {
        showCompileError(globalState.createError(message));
        result.success = false;
    }

    /**
     * Reports an unrecoverable error.
     */
    function fatal(message: string): never {
        throw globalState.createError(message);
    }

    function check(condition: boolean, message: string): asserts condition {
        if (!condition) {
            fatal(message);
        }
    }

    function checkNodeKind(node, kinds, message: string = `Expected ${kinds.join(' or ')}, got ${node.kind}.`) {
        check(kinds.includes(node.kind), message);
    }

    //endregion

    //region Tree traversal
    function top() {
        return R.last(stack);
    }

    function into(fn, node, state) {
        return descend(fn, state)(node);
    }

    function descend<T>(fn: (node, state: CodegenState) => T, state: CodegenState): (node: AnyNode) => T {
        return node => {
            trace('traverse', 'enter', node.kind, showLocation(node.location));
            stack.push(node);

            const result = fn(node, state);

            trace('traverse', 'leave', node.kind, showLocation(node.location));
            stack.pop();

            return result;
        };
    }

    function match(node: AnyNode, mappings): void {
        if (!mappings.hasOwnProperty(node.kind)) {
            throw new Error(`match(): Unhandled node kind: ${node.kind}.`);
        }

        mappings[node.kind](node);
    }

    //endregion

    return result;
}
