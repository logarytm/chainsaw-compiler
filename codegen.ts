import * as R from 'ramda';
import { bug, CompileError, nodesEqual, showCompileError, showLocation } from './utils';
import { createCallingConvention, getReservationSize, ParameterBindings } from './abi';
import { AssemblyWriter, Immediate, Operand, Register, Relative } from './assembly';
import { RegisterAllocator, registers } from './register';
import { Scope } from './scope';
import {
    Binding,
    CodegenState,
    FUNCTION_NATURE,
    FunctionBinding,
    PARAMETER_NATURE, ParameterBinding,
    VARIABLE_NATURE,
} from './contracts';
import {
    AnyNode,
    ArrayDereference,
    BinaryOperator,
    Body,
    ConditionalStatement,
    Expression,
    ExpressionStatement,
    FunctionApplication,
    FunctionDeclaration,
    FunctionDefinition, FunctionStatement, Identifier,
    InlineAssembler,
    LoopingStatement, NumberLiteral,
    Program,
    ReturnStatement,
    Statement, StringLiteral,
    TopLevelStatement, Type,
    UnaryOperator,
    VariableDeclaration,
    NodeKind, NodeOfKind,
} from './grammar';

declare global {
    const tracing: any;
}

type CodegenResult = {
    success: boolean;
};

export function generateCode(topLevelStatements: Program, writer: AssemblyWriter, options: any): CodegenResult {
    const result: CodegenResult = { success: true };
    const stack: AnyNode[] = [];
    const rootScope: Scope = new Scope();

    let stringCounter: number = 0;

    function generateTopLevelStatement(statement: TopLevelStatement, state: CodegenState) {
        switch (statement.kind) {
        case 'FunctionDefinition':
        case 'FunctionDeclaration':
            generateFunctionDeclinition(statement, state);
            break;

        case 'VariableDeclaration':
            generateVariableDeclaration(statement, state);
            break;

        default:
            fatal(`Unexpected top-level node kind.`);
        }
    }

    function generateFunctionDeclinition(declinition: FunctionDeclaration | FunctionDefinition, state: CodegenState) {
        checkNodeKinds(declinition, ['FunctionDefinition', 'FunctionDeclaration']);

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
        const binding: FunctionBinding = {
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

        binding.callingConvention.assertDeclarationIsValid(binding, state);

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

        check(declinition.kind === 'FunctionDefinition', ``);

        const parameterBindings: ParameterBindings = {};
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

    function generateVariableDeclaration(declaration: VariableDeclaration, state: CodegenState): void {
        const variableName = String(declaration.variableName);
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
                computeExpression(register, declaration.initialValue as Expression, state);
                writer.opcode('mov', new Relative(label), register);
            });
        }
    }

    function generateStatement(statement: FunctionStatement, state: CodegenState): void {
        switch (statement.kind) {
        case 'VariableDeclaration':
            into(generateVariableDeclaration, statement, state);
            break;

        case 'ConditionalStatement':
            into(generateConditionalStatement, statement, state);
            break;

        case 'LoopingStatement':
            into(generateLoopingStatement, statement, state);
            break;

        case 'ReturnStatement':
            into(generateReturnStatement, statement, state);
            break;

        case 'ExpressionStatement':
            into(generateExpressionStatement, statement, state);
            break;

        case 'InlineAssembler':
            into(generateInlineAssembler, statement, state);
            break;

        default:
            bug(`Invalid node type: ${statement}.`);
        }
    }

    function generateInlineAssembler(assembler: InlineAssembler, state: CodegenState): void {
        writer.raw(assembler.instructions);
    }

    function generateExpressionStatement(statement: ExpressionStatement, state: CodegenState): void {
        const expression = statement.expression;
        state.callWithFreeRegister(register => {

            // TODO(optimize): omit calculation if expression has no side effects
            computeExpression(register, expression, state);
        });
    }

    function generateConditionalStatement(statement: ConditionalStatement, state: CodegenState): void {
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

    function generateLoopingStatement(statement: LoopingStatement, state: CodegenState) {
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

    function generateBody(body: Body, state: CodegenState): void {
        body.statements.forEach(statement => generateStatement(statement, state));
    }

    function generateReturnStatement(rs: ReturnStatement, state: CodegenState): void {
        computeExpression(registers.ax, rs.expression, state);
        writer.opcode('ret');
    }

    function computeExpression(destinationRegister: Register, expression: Expression, state: CodegenState): void {
        switch (expression.kind) {
        case 'FunctionApplication': {
            assumeNodeKind(expression, 'FunctionApplication');

            check(expression.function.kind === 'Identifier', `Calling expressions as functions is not implemented.`);

            const functionName = expression.function.name;
            const binding = state.scope.lookup(functionName, (name: string): never => {
                return fatal(`${functionName} is not defined.`);
            });

            check(binding.nature === FUNCTION_NATURE, `${functionName} is not a function.`);

            check(
                expression.args.length === binding.arity,
                `Wrong number of arguments to ${functionName} (expected ${binding.arity}, got ${expression.args.length}).`,
            );

            // XXX: Not sure if the extend is necessary
            binding.callingConvention.emitCall(binding, expression.args, state.extend({}), computeExpression);
        }
            break;

        case 'ArrayDereference': {
            assumeNodeKind(expression, 'ArrayDereference');

            state.callWithFreeRegisters(2, (arrayRegister, offsetRegister) => {
                computeExpression(arrayRegister, expression.array, state);
                computeExpression(offsetRegister, expression.offset, state);

                writer.opcode('add', arrayRegister, offsetRegister);
                writer.opcode('mov', destinationRegister, new Relative(arrayRegister));
            });
        }
            break;

        case 'UnaryOperator': {
            assumeNodeKind(expression, 'UnaryOperator');

            switch (expression.operator) {
            case 'not':
                state.borrowRegister(destinationRegister, () => {
                    computeExpression(destinationRegister, expression.operand, state);
                    writer.opcode('not', destinationRegister);
                });
                break;

            default:
                throw new Error(`Unary operator not implemented: ${expression.operator}.`);
            }
        }
            break;

        case 'BinaryOperator': {
            assumeNodeKind(expression, 'BinaryOperator');

            switch (expression.operator) {

                //region Relational operators
            case '<':
            case '>': {
                const copyFlag = { '<': 'cff', '>': 'cof' }[expression.operator];

                state.callWithFreeRegisters(2, (lhsRegister, rhsRegister) => {
                    computeExpression(lhsRegister, expression.lhs, state);
                    computeExpression(rhsRegister, expression.rhs, state);
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
                const shouldNegate = expression.operator === '!=';

                state.callWithFreeRegister(rhsRegister => {
                    computeExpression(destinationRegister, expression.lhs, state);
                    computeExpression(rhsRegister, expression.rhs, state);
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

                    computeExpression(destinationRegister, expression.lhs, state);
                    writer.opcode('test', destinationRegister, new Immediate(0));
                    writer.opcode('jnz', exit);
                    computeExpression(destinationRegister, expression.rhs, state);
                    writer.label(exit);
                });
                break;

            case 'and':
                state.callWithFreeRegister(rhsRegister => {
                    const exit = writer.createLabel();

                    computeExpression(destinationRegister, expression.lhs, state);
                    writer.opcode('test', destinationRegister, new Immediate(0));
                    writer.opcode('jz', exit);
                    computeExpression(destinationRegister, expression.rhs, state);
                    writer.label(exit);
                });
                break;

                //endregion

                //region Assignment operators
            case '=': {
                let lhsOperand: Operand;

                switch (expression.lhs.kind) {
                case 'Identifier': {
                    const identifier = expression.lhs;
                    lhsOperand = new Relative(state.scope.lookup(identifier.name, (name: string): never => {
                        return fatal(`${identifier.name} is not defined`);
                    }).label);
                    break;
                }

                default: {
                    throw new Error(`Unimplemented l-value kind: ${expression.lhs.kind}.`);
                }
                }

                state.callWithFreeRegister(rhsRegister => {
                    computeExpression(rhsRegister, expression.rhs, state);
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
                }[expression.operator];

                state.callWithFreeRegister(rhsRegister => {
                    computeExpression(destinationRegister, expression.lhs, state);
                    computeExpression(rhsRegister, expression.rhs, state);
                    writer.opcode(opcode, destinationRegister, rhsRegister);
                });
                break;
            }
                //endregion

            default:
                throw new Error(`Binary operator not implemented: ${expression.operator}.`);
            }
        }
            break;

        case 'Identifier': {
            assumeNodeKind(expression, 'Identifier');

            const name = expression.name;

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

            const binding = state.scope.lookup(name, (name: string): never => {
                return fatal(`${name} is not defined.`);
            });

            check(binding.nature === VARIABLE_NATURE || binding.nature === PARAMETER_NATURE, `${name} is not an l-value.`);
            writer.opcode('mov', destinationRegister, new Relative(binding.label));
        }
            break;

        case 'Number': {
            assumeNodeKind(expression, 'Number');

            writer.opcode('mov', destinationRegister, new Immediate(expression.value));
        }
            break;

        case 'String': {
            assumeNodeKind(expression, 'String');

            const string = expression.string;
            const encoded = [...string].map(c => c.charCodeAt(0));
            const id = 'S' + stringCounter++;
            const label = writer.reserve(id, string.length, [string.length, ...encoded]);

            writer.opcode('lea', destinationRegister, new Relative(label));
        }
            break;

        }
    }

    // Write traces as comments in assembly output.
    tracing.setTraceHandler(traceHandler);

    const globalState: CodegenState = {
        registerAllocator: new RegisterAllocator(writer),
        scope: rootScope,
        prefix: '',
        assemblyWriter: writer,

        extend(this: CodegenState, obj: Partial<CodegenState>): CodegenState {
            return Object.assign({}, this, obj);
        },

        createError(this: CodegenState, message: string): CompileError {
            return new CompileError(message, top().location, options.filename);
        },

        callWithFreeRegister<T>(this: CodegenState, fn: (register: Register) => T): T {
            return this.registerAllocator.callWithFreeRegister(fn);
        },

        // Allocates a number of registers to be used at the same time.
        callWithFreeRegisters<T>(
            this: CodegenState,
            count: number,
            fn: (...registers: Register[]) => T,
            registers: Register[] = [],
        ): T {
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

        borrowRegister<T>(this: CodegenState, register: Register, fn: () => T) {
            return this.registerAllocator.borrowRegister(register, fn);
        },
    };

    topLevelStatements.forEach(descend(generateTopLevelStatement, globalState));

    tracing.restoreTraceHandler();

    //region Types
    function isVoidType(type: Type) {
        return type.kind === 'NamedType' && type.name === 'void';
    }

    //endregion

    //region Tracing
    function traceHandler(family: string, ...args: any) {
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

    function assumeNodeKind<TKind extends NodeKind>(
        node: AnyNode,
        kind: TKind,
        message: string = `Expected ${kind}, got ${node.kind}.`
    ): asserts node is NodeOfKind<TKind> {
    }

    function checkNodeKinds(node: AnyNode, kinds: string[], message: string = `Expected ${kinds.join(' or ')}, got ${node.kind}.`) {
        check(kinds.includes(node.kind), message);
    }

    //endregion

    //region Tree traversal
    function top(): AnyNode {
        const last = R.last(stack);

        if (last === undefined) {
            throw new Error('top(): Empty stack');
        }

        return last;
    }

    function into<T, TNode extends AnyNode>(
        fn: (node: TNode, state: CodegenState) => T,
        node: TNode,
        state: CodegenState,
    ): T {
        return descend(fn, state)(node);
    }

    function descend<T, TNode extends AnyNode>(
        fn: (node: TNode, state: CodegenState) => T,
        state: CodegenState,
    ): (node: TNode) => T {
        return node => {
            trace('traverse', 'enter', node.kind, showLocation(node.location));
            stack.push(node);

            const result = fn(node, state);

            trace('traverse', 'leave', node.kind, showLocation(node.location));
            stack.pop();

            return result;
        };
    }

    //endregion

    return result;
}
