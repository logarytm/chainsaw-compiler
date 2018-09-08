const R = require('ramda');
const { Scope } = require('./scope.js');
const { Register, Absolute, Relative, Immediate, Label } = require('./assembly.js');
const { showLocation, inspect } = require('./utility.js');

const registers = {
    ax: new Register('AX'),
    bx: new Register('BX'),
    cx: new Register('CX'),
    dx: new Register('DX'),
};

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

        definition.body.statements.forEach(descend(generateStatement, state.extend({
            scope: state.scope.extend(),
            prefix: `${state.prefix}${functionName}$`,
        })));
    }

    function generateStatement(statement, state) {
        match(statement, {
            VariableDeclaration: descend(generateVariableDeclaration, state),
            LoopingStatement: descend(generateLoopingStatement, state),
            ReturnStatement: descend(generateReturnStatement, state),
            ExpressionStatement: descend(
                R.compose(
                    R.partial(computeExpression, [registers.ax]),
                    node => node.expression,
                ), state),
        });
    }

    function generateLoopingStatement(statement, state) {
        const start = writer.labelHere();
        const exit = writer.prepareLabel();

        computeExpression(registers.ax, statement.predicate, state);
        into(generateBody, statement.doBody, state);
        writer.label(exit);
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

    function computeExpression(destinationRegister, expression, state) {
        match(expression, {
            UnaryOperator(operator) {
                switch (operator.operator) {
                case 'not':
                    writer.not(destinationRegister);
                    break;

                default:
                    throw new Error('unary operator not implemented');
                }
            },

            BinaryOperator(operator) {
            },

            Identifier({ name }) {
                return new Relative(state.scope.lookup(name).label);
            },
        });
    }

    function computeAddress(destinationRegister, expression, state) {
        preserveRegister(registers.dx, () => {
            writer.mov(destinationRegister, new Immediate(42));
        });
    }

    const statePrototype = {
        extend(obj) {
            return Object.assign({}, this, obj);
        },
    };

    topLevelStatements.forEach(descend(generateFunctionDefinition, statePrototype.extend({
        scope: rootScope,
        prefix: '',
    })));

    //region Error reporting
    function error(message) {
        console.log(`error: at ${showLocation(R.last(stack).location)}: ${message}`);
        result.success = false;
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
