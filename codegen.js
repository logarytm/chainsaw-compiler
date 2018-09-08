const R = require('ramda');
const { Scope } = require('./scope.js');
const { Register, Absolute, Relative, Immediate, Label } = require('./assembly.js');
const { CompileError, showLocation, inspect } = require('./utility.js');
const { registers, RegisterAllocator } = require('./register.js');

const VARIABLE = Symbol('variable');
const FUNCTION = Symbol('function');

function generateCode(topLevelStatements, writer) {
    function preserveRegister(register, fn) {
        writer.push(registers.ax);
        fn();
        writer.pop(registers.ax);
    }

    const preserveAx = fn => preserveRegister(registers.ax, fn);
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
        }, redefinition(functionName));

        const parameterBindings = {};
        for (const parameter of declinition.parameters) {
            parameterBindings[parameter.name] = {
                label: writer.reserve(functionName + '$' + parameter.name),
                name: parameter.name,
            };
        }

        if (!isDefinition) {
            return;
        }

        writer.label(label);
        declinition.body.statements.forEach(descend(generateStatement, state.extend({
            scope: state.scope.extend(parameterBindings),
            prefix: `${state.prefix}${functionName}$`,
        })));
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
            writer.jz(elseLabel);
            into(generateBody, statement.thenBranch, state);
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
            writer.jz(exit);
            into(generateBody, statement.body, state);
            writer.jmp(start);
            writer.label(exit);
        });
    }

    function generateBody(body, state) {
        body.statements.forEach(descend(generateStatement, state));
    }

    function generateVariableDeclaration(declaration, state) {
        const variableName = declaration.variableName;
        const label = writer.reserve(state.prefix + variableName);

        state.scope.bind(variableName, {
            label,
            type: declaration.variableType,
            nature: VARIABLE,
        });
    }

    function generateReturnStatement(rs, state) {
        computeExpression(registers.ax, rs.expression, state);
        writer.ret();
    }

    function computeExpression(destinationRegister, expression, state = mandatory()) {
        match(expression, {
            FunctionApplication(application) {
            },

            ArrayDereference(dereference) {
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
                    // TODO(refactor): flatten register allocation
                    state.callWithFreeRegister(lhsRegister => {
                        const copyFlag = { '<': 'ccf', '>': 'cof' }[operator.operator];

                        return state.callWithFreeRegister(rhsRegister => {
                            computeExpression(lhsRegister, operator.lhs, state);
                            computeExpression(rhsRegister, operator.rhs, state);
                            writer.cmp(lhsRegister, rhsRegister);
                            state.borrowRegister(registers.dx, () => {
                                writer.opcode(copyFlag);
                                writer.mov(destinationRegister, registers.dx);
                            });
                        })
                    });
                    break;
                }

                case '==':
                case '!=': {
                    const shouldNegate = operator.operator === '!=';

                    state.callWithFreeRegister(lhsRegister => {
                        return state.callWithFreeRegister(rhsRegister => {
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
                        })
                    });
                    break;
                }
                    //endregion

                    //region Assignment operator
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

    const statePrototype = {
        extend(obj) {
            return Object.assign({}, this, obj);
        },
    };

    topLevelStatements.forEach(descend(generateFunctionDeclinition, statePrototype.extend({
        scope: rootScope,
        registerAllocator: new RegisterAllocator(writer),
        callWithFreeRegister(fn) {
            return this.registerAllocator.callWithFreeRegister(fn);
        },
        borrowRegister(register, fn) {
            return this.registerAllocator.borrowRegister(register, fn);
        },
        prefix: '',
    })));

    //region Types
    function isVoidType(type) {
        return type.kind === 'NamedType' && type.name === 'void';
    }

    //endregion

    //region Error reporting
    function error(message) {
        console.log(`error: at ${showLocation(R.last(stack).location)}: ${message}`);
        result.success = false;
    }

    function fatal(message) {
        throw new CompileError(message, R.last(stack).location);
    }

    function check(condition, message) {
        if (!condition) {
            error(message);
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
    function into(fn, node, state = mandatory()) {
        return descend(fn, state)(node);
    }

    function descend(fn, state = mandatory()) {
        return node => {
            stack.push(node);
            const result = fn(node, state);
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
