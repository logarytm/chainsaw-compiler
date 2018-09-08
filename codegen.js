const R = require('ramda');
const { Scope } = require('./scope.js');
const { Register, Absolute, Relative, Immediate, Label } = require('./assembly.js');
const { CompileError, showLocation, inspect } = require('./utility.js');
const { registers, RegisterAllocator } = require('./register.js');

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

    function generateFunctionDefinition(definition, state) {
        checkNodeKind(definition, ['FunctionDefinition']);

        const functionName = definition.functionName;
        const label = writer.labelHere(functionName);
        state.scope.bind(functionName, label, redefinition(functionName));

        const parameterBindings = {};
        for (const parameter of definition.parameters) {
            parameterBindings[parameter.name] = {
                label: writer.reserve(functionName + '$' + parameter.name),
                name: parameter.name,
            };
        }

        definition.body.statements.forEach(descend(generateStatement, state.extend({
            scope: state.scope.extend(parameterBindings),
            prefix: `${state.prefix}${functionName}$`,
        })));
    }

    function generateStatement(statement, state) {
        match(statement, {
            VariableDeclaration: descend(generateVariableDeclaration, state),
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

    function generateLoopingStatement(statement, state) {
        const start = writer.labelHere();
        const exit = writer.prepareLabel();

        state.callWithFreeRegister(predicateRegister => {
            computeExpression(predicateRegister, statement.predicate, state);
            writer.cmp(predicateRegister, predicateRegister);
            writer.jz(exit);
            into(generateBody, statement.doBody, state);
            writer.label(exit);
        });
    }

    function generateBody(body, state) {
        body.statements.forEach(descend(generateStatement, state));
    }

    function generateVariableDeclaration(declaration, state) {
        const variableName = declaration.variableName;
        const label = writer.reserve(state.prefix + variableName);

        state.scope.bind(variableName, { label, type: declaration.variableType });
    }

    function generateReturnStatement(rs, state) {
        computeExpression(registers.ax, rs.expression, state);
        writer.ret();
    }

    function computeExpression(destinationRegister, expression, state = mandatory()) {
        match(expression, {
            UnaryOperator(operator) {
                switch (operator.operator) {
                case 'not':
                    state.borrowRegister(destinationRegister, () => {
                        computeExpression(destinationRegister, operator.operand, state);
                        writer.not(destinationRegister);
                    });
                    break;

                default:
                    throw new Error('unary operator not implemented');
                }
            },

            BinaryOperator(operator) {
                switch (operator.operator) {

                case '<': {
                    // TODO: refactor nested cWFR()
                    state.callWithFreeRegister(lhsRegister => {
                        return state.callWithFreeRegister(rhsRegister => {
                            computeExpression(lhsRegister, operator.lhs, state);
                            computeExpression(rhsRegister, operator.rhs, state);
                            writer.cmp(lhsRegister, rhsRegister);
                            state.borrowRegister(registers.dx, () => {
                                writer.ccf(destinationRegister);
                                writer.mov(destinationRegister, registers.dx);
                            });
                        })
                    });
                    break;
                }

                case '=': {
                    if (operator.lhs.kind !== 'Identifier') {
                        throw new Error(`unsupported lvalue: ${operator.lhs.kind}`);
                    }

                    const identifier = operator.lhs;
                    state.callWithFreeRegister(rhsRegister => {
                        computeExpression(rhsRegister, operator.rhs, state);
                        writer.mov(state.scope.lookup(identifier.name, () => {
                            error(`${identifier.name} is not defined`);
                        }).label, rhsRegister);
                    });
                    break;
                }

                case '*': {
                    if (operator.lhs.kind !== 'Identifier') {
                        throw new Error(`unsupported lvalue: ${operator.lhs.kind}`);
                    }

                    state.callWithFreeRegister(rhsRegister => {
                        computeExpression(destinationRegister, operator.lhs, state);
                        computeExpression(rhsRegister, operator.rhs, state);
                        writer.Smul6(destinationRegister, rhsRegister);
                    });
                    break;
                }

                case '-': {
                    if (operator.lhs.kind !== 'Identifier') {
                        throw new Error(`unsupported lvalue: ${operator.lhs.kind}`);
                    }

                    state.callWithFreeRegister(rhsRegister => {
                        computeExpression(destinationRegister, operator.lhs, state);
                        computeExpression(rhsRegister, operator.rhs, state);
                        writer.sub(destinationRegister, rhsRegister);
                    });
                    break;
                }

                default:
                    throw new Error(`binary operator not implemented: "${operator.operator}"`);
                }
            },

            Identifier({ name }) {
                writer.mov(destinationRegister, new Relative(state.scope.lookup(name, () => {
                    fatal(`${name} is not defined`);
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

    topLevelStatements.forEach(descend(generateFunctionDefinition, statePrototype.extend({
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

    function checkNodeKind(node, kinds, message = `expected ${kinds.join(' or ')}, got ${node.kind}`) {
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
