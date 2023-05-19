(function(){function r(e,n,t){function o(i,f){if(!n[i]){if(!e[i]){var c="function"==typeof require&&require;if(!f&&c)return c(i,!0);if(u)return u(i,!0);var a=new Error("Cannot find module '"+i+"'");throw a.code="MODULE_NOT_FOUND",a}var p=n[i]={exports:{}};e[i][0].call(p.exports,function(r){var n=e[i][1][r];return o(n||r)},p,p.exports,r,e,n,t)}return n[i].exports}for(var u="function"==typeof require&&require,i=0;i<t.length;i++)o(t[i]);return o}return r})()({1:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createCallingConvention = exports.getReservationSize = void 0;
const assembly_1 = require("./assembly");
require("./utils");
function getReservationSize(type) {
    switch (type.kind) {
        case 'NamedType':
        case 'PointerType':
            return 1;
        case 'ArrayType':
            return type.capacity.value * getReservationSize(type.type);
    }
}
exports.getReservationSize = getReservationSize;
class StdcallConvention {
    assertDeclarationIsValid(binding, state) {
    }
    emitCall(binding, args, state, computeExpressionIntoRegister) {
        for (let argument of args) {
            state.callWithFreeRegister(register => {
                computeExpressionIntoRegister(register, argument, state);
                state.assemblyWriter.opcode('push', register);
            });
        }
        state.assemblyWriter.opcode('call', new assembly_1.Relative(binding.label));
        trace('stdcall', 'caller-cleanup', 'start');
        state.callWithFreeRegister(register => {
            state.assemblyWriter.opcode('pop', register);
        });
        trace('stdcall', 'caller-cleanup', 'end');
    }
    emitPrologue(binding, parameterBindings, state) {
    }
    emitEpilogue(binding, parameterBindings, state) {
    }
}
class FastcallConvention {
    constructor() {
        this.registers = [new assembly_1.Register('ax'), new assembly_1.Register('bx'), new assembly_1.Register('cx'), new assembly_1.Register('dx')];
    }
    assertDeclarationIsValid(declaration, state) {
        if (declaration.parameters.length > this.registers.length) {
            throw state.createError(`Fastcall convention supports at most ${this.registers.length} parameters.`);
        }
    }
    emitCall(binding, args, state, computeExpressionIntoRegister) {
        trace('fastcall', 'save');
        this.registers.forEach(r => state.assemblyWriter.opcode('push', r));
        trace('fastcall', 'saved');
        for (let i = 0; i < args.length; i++) {
            computeExpressionIntoRegister(this.registers[i], args[i], state);
        }
        state.assemblyWriter.opcode('call', new assembly_1.Relative(binding.label));
        trace('fastcall', 'restore');
        this.registers.reverse().forEach(r => state.assemblyWriter.opcode('pop', r));
        trace('fastcall', 'end');
    }
    emitPrologue(binding, parameterBindings, state) {
        if (binding.parameters.length) {
            binding.parameters.forEach((parameter, i) => {
                state.assemblyWriter.opcode('mov', parameterBindings[parameter.name].label, this.registers[i]);
            });
        }
    }
    emitEpilogue(binding, parameterBindings, state) {
    }
}
function createCallingConvention(name) {
    switch (name) {
        case 'stdcall':
            return new StdcallConvention();
        case 'fastcall':
            return new FastcallConvention();
        default:
            throw new Error(`Unimplemented calling convention: ${name}.`);
    }
}
exports.createCallingConvention = createCallingConvention;

},{"./assembly":2,"./utils":11}],2:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Relative = exports.Absolute = exports.Immediate = exports.Register = exports.Label = exports.Operand = exports.AssemblyWriter = void 0;
class AssemblyWriter {
    constructor() {
        this.output = [];
        this.reservations = [];
        this.labelno = 0;
    }
    comment(text) {
        this.output.push(new CommentLine(text));
    }
    createLabel(name = null) {
        if (name === null) {
            name = `L${this.labelno}$`;
            this.labelno++;
        }
        return new Label(name);
    }
    label(label) {
        this.output.push(new LabelLine(label));
    }
    createAndEmitLabel(name = null) {
        const label = this.createLabel(name);
        this.label(label);
        return label;
    }
    opcode(opcode, ...operands) {
        this.output.push(new OpcodeLine(opcode, operands));
    }
    raw(instructions) {
        this.output.push(new RawLine(instructions));
    }
    dump() {
        this.output.forEach(line => {
            if (process.stdout.isTTY) {
                if (line instanceof CommentLine) {
                    console.log(`\x1b[32m${line.format()}\x1b[0m`);
                    return;
                }
                else if (line instanceof OpcodeLine) {
                    console.log(`\x1b[31m${line.format().replace(/(?<=\S) /, '\x1b[0m ')}\x1b[0m`);
                    return;
                }
            }
            console.log(line.format());
        });
        this.reservations.forEach(reservation => {
            console.log(`.${reservation.name}`);
            console.log(reservation.data.map(x => '    X' + x.toString(2).padStart(16, '0')).join('\n'));
        });
    }
    reserve(name, size = 1, data = []) {
        size = Math.max(data.length, size, 1);
        while (data.length < size) {
            data.push(0);
        }
        this.reservations.push({
            name,
            size,
            data,
        });
        return new Label(name);
    }
    optimize() {
        if (this.output.length === 0) {
            return;
        }
        this.optimizeSpuriousSaves();
        this.optimizeUnusedLabels();
    }
    optimizeUnusedLabels() {
        const used = new Set();
        this.output.forEach(x => {
            if (x instanceof OpcodeLine) {
                x.operands.forEach(operand => {
                    let label = null;
                    if (operand instanceof Label) {
                        label = operand;
                    }
                    else if ((operand instanceof Relative || operand instanceof Absolute) && operand.target instanceof Label) {
                        label = operand.target;
                    }
                    if (label !== null) {
                        used.add(label.name);
                    }
                });
            }
        });
        this.output = this.output.filter(line => {
            if (!(line instanceof LabelLine)) {
                return true;
            }
            return used.has(line.label.name) || !line.label.isInternal();
        });
        this.reservations = this.reservations.filter(reservation => {
            return used.has(reservation.name);
        });
    }
    optimizeSpuriousSaves() {
        const newOutput = [this.output[0]];
        for (let i = 1; i < this.output.length; i++) {
            const previousLine = this.output[i - 1];
            const currentLine = this.output[i];
            if (previousLine instanceof OpcodeLine && currentLine instanceof OpcodeLine &&
                previousLine.opcode.toLowerCase() === 'push' && currentLine.opcode.toLowerCase() === 'pop' &&
                previousLine.operands[0] instanceof Register && currentLine.operands[0] instanceof Register &&
                previousLine.operands[0].isEqualTo(currentLine.operands[0])) {
                newOutput.pop();
                continue;
            }
            newOutput.push(currentLine);
        }
        this.output = newOutput;
    }
}
exports.AssemblyWriter = AssemblyWriter;
class RawLine {
    constructor(text) {
        this.text = text;
    }
    format() {
        return this.text
            .trim()
            .split('\n')
            .map(x => `    ` + x.trim())
            .join('\n');
    }
}
class CommentLine {
    constructor(text) {
        this.text = text;
    }
    format() {
        return `    ' ${this.text}`;
    }
}
class LabelLine {
    constructor(label) {
        this.label = label;
    }
    format() {
        return `.${this.label.name}`;
    }
}
class OpcodeLine {
    constructor(opcode, operands) {
        this.opcode = opcode.toUpperCase();
        this.operands = operands;
    }
    format() {
        return '    ' + `${this.opcode} ${this.operands.map(x => x.format()).join(',')}`.trim();
    }
}
class Operand {
    constructor(expression) {
        this.expression = expression;
    }
    isEqualTo(other) {
        return other instanceof this.constructor && other.expression === this.expression;
    }
}
exports.Operand = Operand;
class Label extends Operand {
    get name() {
        return this.expression;
    }
    format() {
        return `.${this.expression}`;
    }
    isInternal() {
        return this.name.endsWith('$');
    }
}
exports.Label = Label;
class Register extends Operand {
    format() {
        return this.name;
    }
    get name() {
        return this.expression.toUpperCase();
    }
}
exports.Register = Register;
class Immediate extends Operand {
    format() {
        return `(${this.expression})`;
    }
}
exports.Immediate = Immediate;
class Absolute extends Operand {
    format() {
        return `<${this.expression.format()}>`;
    }
    get target() {
        return this.expression;
    }
}
exports.Absolute = Absolute;
class Relative extends Operand {
    format() {
        return `[${this.expression.format()}]`;
    }
    get target() {
        return this.expression;
    }
}
exports.Relative = Relative;

},{}],3:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateCode = void 0;
const R = require("ramda");
const utils_1 = require("./utils");
const abi_1 = require("./abi");
const assembly_1 = require("./assembly");
const register_1 = require("./register");
const scope_1 = require("./scope");
const contracts_1 = require("./contracts");
function generateCode(topLevelStatements, writer, options) {
    const result = { success: true };
    const stack = [];
    const rootScope = new scope_1.Scope();
    let stringCounter = 0;
    function generateTopLevelStatement(statement, state) {
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
    function generateFunctionDeclinition(declinition, state) {
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
        const binding = {
            label,
            functionName,
            isDefinition,
            arity: declinition.parameters.length,
            parameters: declinition.parameters,
            returnType: declinition.returnType,
            hasReturnValue: !isVoidType(declinition.returnType),
            callingConvention: (0, abi_1.createCallingConvention)(declinition.callingConvention),
            nature: contracts_1.FUNCTION_NATURE,
        };
        binding.callingConvention.assertDeclarationIsValid(binding, state);
        state.scope.bind(functionName, binding, function alreadyBound(previousBinding) {
            check(previousBinding.nature === contracts_1.FUNCTION_NATURE, `Redefinition of ${functionName} with different type`);
            // There can never be more than one definition.
            if (previousBinding.isDefinition && binding.isDefinition) {
                fatal(`Redefinition of ${functionName}.`);
            }
            // But there can be multiple declarations.  We check if they have the same parameters and return type.
            const isEquivalent = previousBinding.nature === contracts_1.FUNCTION_NATURE
                && (0, utils_1.nodesEqual)(binding.parameters.map(p => p.type), previousBinding.parameters.map(p => p.type))
                && (0, utils_1.nodesEqual)(binding.returnType, previousBinding.returnType);
            check(isEquivalent, `Redeclaration of ${functionName} with different type.`);
        });
        if (!isDefinition) {
            // This is only a declaration, we are done here.
            return;
        }
        check(declinition.kind === 'FunctionDefinition', ``);
        const parameterBindings = {};
        for (const parameter of declinition.parameters) {
            check(parameter.type.kind !== 'ArrayType', 'Cannot pass arrays as arguments. Use a pointer instead.');
            parameterBindings[parameter.name] = {
                label: writer.reserve(functionName + '.P' + parameter.name),
                name: parameter.name,
                type: parameter.type,
                nature: contracts_1.PARAMETER_NATURE,
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
    function generateVariableDeclaration(declaration, state) {
        const variableName = String(declaration.variableName);
        const label = writer.reserve(state.prefix + 'V' + variableName, (0, abi_1.getReservationSize)(declaration.variableType));
        state.scope.bind(variableName, {
            label,
            name: variableName,
            type: declaration.variableType,
            nature: contracts_1.VARIABLE_NATURE,
        }, function (binding) {
            error(`Name ${variableName} is already bound.`);
        });
        if (declaration.initialValue !== null) {
            check(declaration.variableType.kind !== 'ArrayType', 'Cannot initialize arrays at definition time.');
            state.callWithFreeRegister(register => {
                computeExpression(register, declaration.initialValue, state);
                writer.opcode('mov', new assembly_1.Relative(label), register);
            });
        }
    }
    function generateStatement(statement, state) {
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
                (0, utils_1.bug)(`Invalid node type: ${statement}.`);
        }
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
            writer.opcode('jz', new assembly_1.Relative(elseLabel));
            into(generateBody, statement.thenBranch, state);
            writer.opcode('jmp', new assembly_1.Relative(afterLabel));
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
            writer.opcode('jz', new assembly_1.Relative(exit));
            into(generateBody, statement.body, state);
            writer.opcode('jmp', new assembly_1.Relative(start));
            writer.label(exit);
        });
    }
    function generateBody(body, state) {
        body.statements.forEach(statement => generateStatement(statement, state));
    }
    function generateReturnStatement(rs, state) {
        computeExpression(register_1.registers.ax, rs.expression, state);
        writer.opcode('ret');
    }
    function computeExpression(destinationRegister, expression, state) {
        switch (expression.kind) {
            case 'FunctionApplication':
                {
                    assumeNodeKind(expression, 'FunctionApplication');
                    check(expression.function.kind === 'Identifier', `Calling expressions as functions is not implemented.`);
                    const functionName = expression.function.name;
                    const binding = state.scope.lookup(functionName, (name) => {
                        return fatal(`${functionName} is not defined.`);
                    });
                    check(binding.nature === contracts_1.FUNCTION_NATURE, `${functionName} is not a function.`);
                    check(expression.args.length === binding.arity, `Wrong number of arguments to ${functionName} (expected ${binding.arity}, got ${expression.args.length}).`);
                    // XXX: Not sure if the extend is necessary
                    binding.callingConvention.emitCall(binding, expression.args, state.extend({}), computeExpression);
                }
                break;
            case 'ArrayDereference':
                {
                    assumeNodeKind(expression, 'ArrayDereference');
                    state.callWithFreeRegisters(2, (arrayRegister, offsetRegister) => {
                        computeExpression(arrayRegister, expression.array, state);
                        computeExpression(offsetRegister, expression.offset, state);
                        writer.opcode('add', arrayRegister, offsetRegister);
                        writer.opcode('mov', destinationRegister, new assembly_1.Relative(arrayRegister));
                    });
                }
                break;
            case 'UnaryOperator':
                {
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
            case 'BinaryOperator':
                {
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
                                state.borrowRegister(register_1.registers.dx, () => {
                                    writer.opcode(copyFlag);
                                    writer.opcode('mov', destinationRegister, register_1.registers.dx);
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
                                state.borrowRegister(register_1.registers.dx, () => {
                                    writer.opcode('czf');
                                    writer.opcode('mov', destinationRegister, register_1.registers.dx);
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
                                writer.opcode('test', destinationRegister, new assembly_1.Immediate(0));
                                writer.opcode('jnz', exit);
                                computeExpression(destinationRegister, expression.rhs, state);
                                writer.label(exit);
                            });
                            break;
                        case 'and':
                            state.callWithFreeRegister(rhsRegister => {
                                const exit = writer.createLabel();
                                computeExpression(destinationRegister, expression.lhs, state);
                                writer.opcode('test', destinationRegister, new assembly_1.Immediate(0));
                                writer.opcode('jz', exit);
                                computeExpression(destinationRegister, expression.rhs, state);
                                writer.label(exit);
                            });
                            break;
                        //endregion
                        //region Assignment operators
                        case '=': {
                            let lhsOperand;
                            switch (expression.lhs.kind) {
                                case 'Identifier': {
                                    const identifier = expression.lhs;
                                    lhsOperand = new assembly_1.Relative(state.scope.lookup(identifier.name, (name) => {
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
            case 'Identifier':
                {
                    assumeNodeKind(expression, 'Identifier');
                    const name = expression.name;
                    // Handle pre-defined identifiers.
                    switch (name) {
                        case 'true': {
                            writer.opcode('mov', destinationRegister, new assembly_1.Immediate(1));
                            return;
                        }
                        case 'false': {
                            writer.opcode('mov', destinationRegister, new assembly_1.Immediate(0));
                            return;
                        }
                    }
                    const binding = state.scope.lookup(name, (name) => {
                        return fatal(`${name} is not defined.`);
                    });
                    check(binding.nature === contracts_1.VARIABLE_NATURE || binding.nature === contracts_1.PARAMETER_NATURE, `${name} is not an l-value.`);
                    writer.opcode('mov', destinationRegister, new assembly_1.Relative(binding.label));
                }
                break;
            case 'Number':
                {
                    assumeNodeKind(expression, 'Number');
                    writer.opcode('mov', destinationRegister, new assembly_1.Immediate(expression.value));
                }
                break;
            case 'String':
                {
                    assumeNodeKind(expression, 'String');
                    const string = expression.string;
                    const encoded = [...string].map(c => c.charCodeAt(0));
                    const id = 'S' + stringCounter++;
                    const label = writer.reserve(id, string.length, [string.length, ...encoded]);
                    writer.opcode('lea', destinationRegister, new assembly_1.Relative(label));
                }
                break;
        }
    }
    // Write traces as comments in assembly output.
    tracing.setTraceHandler(traceHandler);
    const globalState = {
        registerAllocator: new register_1.RegisterAllocator(writer),
        scope: rootScope,
        prefix: '',
        assemblyWriter: writer,
        extend(obj) {
            return Object.assign({}, this, obj);
        },
        createError(message) {
            return new utils_1.CompileError(message, top().location, options.filename);
        },
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
    function error(message) {
        (0, utils_1.showCompileError)(globalState.createError(message));
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
    function assumeNodeKind(node, kind, message = `Expected ${kind}, got ${node.kind}.`) {
    }
    function checkNodeKinds(node, kinds, message = `Expected ${kinds.join(' or ')}, got ${node.kind}.`) {
        check(kinds.includes(node.kind), message);
    }
    //endregion
    //region Tree traversal
    function top() {
        const last = R.last(stack);
        if (last === undefined) {
            throw new Error('top(): Empty stack');
        }
        return last;
    }
    function into(fn, node, state) {
        return descend(fn, state)(node);
    }
    function descend(fn, state) {
        return node => {
            trace('traverse', 'enter', node.kind, (0, utils_1.showLocation)(node.location));
            stack.push(node);
            const result = fn(node, state);
            trace('traverse', 'leave', node.kind, (0, utils_1.showLocation)(node.location));
            stack.pop();
            return result;
        };
    }
    //endregion
    return result;
}
exports.generateCode = generateCode;

},{"./abi":1,"./assembly":2,"./contracts":5,"./register":8,"./scope":9,"./utils":11,"ramda":undefined}],4:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const { parseFile } = require('./parse');
const utils_1 = require("./utils");
const { generateCode } = require('./codegen');
const { AssemblyWriter } = require('./assembly');
const cli = require('meow')(`
    Usage
        $ node compile.js <filename> [--debug] [--trace <families>] [--show-parse-tree]
`, {
    flags: {
        'trace': {
            type: 'string',
        },
        'show-parse-tree': {
            type: 'boolean',
        },
    },
});
require('./tracing.js').setup(cli.flags.trace ? cli.flags.trace.split(',') : []);
const debugMode = cli.flags.debug;
const filename = cli.input[0];
if (!cli.input.length) {
    console.error('fatal: No input files.');
    process.exit(1);
}
try {
    const topLevelStatements = parseFile(filename);
    if (cli.flags.showParseTree) {
        (0, utils_1.traceParseTree)(topLevelStatements);
    }
    const assemblyWriter = new AssemblyWriter();
    const result = generateCode(topLevelStatements, assemblyWriter, {
        filename,
    });
    if (result.success || debugMode) {
        assemblyWriter.optimize();
        assemblyWriter.dump();
    }
    process.exit(result.success ? 0 : 1);
}
catch (e) {
    if (e == null) {
        throw e;
    }
    if (!(0, utils_1.isCompileError)(e)) {
        throw e;
    }
    (0, utils_1.showCompileError)(e);
    console.error('fatal: Compilation aborted.');
    process.exit(1);
}

},{"./assembly":2,"./codegen":3,"./parse":7,"./tracing.js":10,"./utils":11,"meow":undefined}],5:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PARAMETER_NATURE = exports.VARIABLE_NATURE = exports.FUNCTION_NATURE = void 0;
/**
 * These values are assigned to names in the scope.  For example, every function declaration has FUNCTION_NATURE, and
 * we can protect from assigning to functions by checking the nature property of a name.
 */
exports.FUNCTION_NATURE = Symbol('function');
exports.VARIABLE_NATURE = Symbol('variable');
exports.PARAMETER_NATURE = Symbol('parameter');

},{}],6:[function(require,module,exports){
/*
 * Generated by PEG.js 0.10.0.
 *
 * http://pegjs.org/
 */

"use strict";

function peg$subclass(child, parent) {
  function ctor() { this.constructor = child; }
  ctor.prototype = parent.prototype;
  child.prototype = new ctor();
}

function peg$SyntaxError(message, expected, found, location) {
  this.message  = message;
  this.expected = expected;
  this.found    = found;
  this.location = location;
  this.name     = "SyntaxError";

  if (typeof Error.captureStackTrace === "function") {
    Error.captureStackTrace(this, peg$SyntaxError);
  }
}

peg$subclass(peg$SyntaxError, Error);

peg$SyntaxError.buildMessage = function(expected, found) {
  var DESCRIBE_EXPECTATION_FNS = {
        literal: function(expectation) {
          return "\"" + literalEscape(expectation.text) + "\"";
        },

        "class": function(expectation) {
          var escapedParts = "",
              i;

          for (i = 0; i < expectation.parts.length; i++) {
            escapedParts += expectation.parts[i] instanceof Array
              ? classEscape(expectation.parts[i][0]) + "-" + classEscape(expectation.parts[i][1])
              : classEscape(expectation.parts[i]);
          }

          return "[" + (expectation.inverted ? "^" : "") + escapedParts + "]";
        },

        any: function(expectation) {
          return "any character";
        },

        end: function(expectation) {
          return "end of input";
        },

        other: function(expectation) {
          return expectation.description;
        }
      };

  function hex(ch) {
    return ch.charCodeAt(0).toString(16).toUpperCase();
  }

  function literalEscape(s) {
    return s
      .replace(/\\/g, '\\\\')
      .replace(/"/g,  '\\"')
      .replace(/\0/g, '\\0')
      .replace(/\t/g, '\\t')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/[\x00-\x0F]/g,          function(ch) { return '\\x0' + hex(ch); })
      .replace(/[\x10-\x1F\x7F-\x9F]/g, function(ch) { return '\\x'  + hex(ch); });
  }

  function classEscape(s) {
    return s
      .replace(/\\/g, '\\\\')
      .replace(/\]/g, '\\]')
      .replace(/\^/g, '\\^')
      .replace(/-/g,  '\\-')
      .replace(/\0/g, '\\0')
      .replace(/\t/g, '\\t')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/[\x00-\x0F]/g,          function(ch) { return '\\x0' + hex(ch); })
      .replace(/[\x10-\x1F\x7F-\x9F]/g, function(ch) { return '\\x'  + hex(ch); });
  }

  function describeExpectation(expectation) {
    return DESCRIBE_EXPECTATION_FNS[expectation.type](expectation);
  }

  function describeExpected(expected) {
    var descriptions = new Array(expected.length),
        i, j;

    for (i = 0; i < expected.length; i++) {
      descriptions[i] = describeExpectation(expected[i]);
    }

    descriptions.sort();

    if (descriptions.length > 0) {
      for (i = 1, j = 1; i < descriptions.length; i++) {
        if (descriptions[i - 1] !== descriptions[i]) {
          descriptions[j] = descriptions[i];
          j++;
        }
      }
      descriptions.length = j;
    }

    switch (descriptions.length) {
      case 1:
        return descriptions[0];

      case 2:
        return descriptions[0] + " or " + descriptions[1];

      default:
        return descriptions.slice(0, -1).join(", ")
          + ", or "
          + descriptions[descriptions.length - 1];
    }
  }

  function describeFound(found) {
    return found ? "\"" + literalEscape(found) + "\"" : "end of input";
  }

  return "Expected " + describeExpected(expected) + " but " + describeFound(found) + " found.";
};

function peg$parse(input, options) {
  options = options !== void 0 ? options : {};

  var peg$FAILED = {},

      peg$startRuleFunctions = { Program: peg$parseProgram },
      peg$startRuleFunction  = peg$parseProgram,

      peg$c0 = function(statements) { return statements.map(nth(0)).filter(notEmpty); },
      peg$c1 = function(declaration) { return declaration; },
      peg$c2 = function(definition) { return definition; },
      peg$c3 = "fn",
      peg$c4 = peg$literalExpectation("fn", false),
      peg$c5 = function(callingConvention, functionName, parameters, returnType) {
              return tree.FunctionDeclaration({
                  functionName: String(functionName),
                  callingConvention,
                  parameters,
                  returnType,
              });
          },
      peg$c6 = function(callingConvention, functionName, parameters, returnType, body) {
              return tree.FunctionDefinition({
                  functionName: String(functionName),
                  callingConvention,
                  parameters,
                  returnType,
                  body,
              });
          },
      peg$c7 = function(name) { return name; },
      peg$c8 = function() { return "stdcall"; },
      peg$c9 = "stdcall",
      peg$c10 = peg$literalExpectation("stdcall", false),
      peg$c11 = "fastcall",
      peg$c12 = peg$literalExpectation("fastcall", false),
      peg$c13 = function() { return "fastcall"; },
      peg$c14 = "(",
      peg$c15 = peg$literalExpectation("(", false),
      peg$c16 = ")",
      peg$c17 = peg$literalExpectation(")", false),
      peg$c18 = function() { return []; },
      peg$c19 = ",",
      peg$c20 = peg$literalExpectation(",", false),
      peg$c21 = function(head, tail) { return [head].concat(tail.map(nth(3))); },
      peg$c22 = function(name, type) { return tree.NameTypePair({ name, type }); },
      peg$c23 = "{",
      peg$c24 = peg$literalExpectation("{", false),
      peg$c25 = "}",
      peg$c26 = peg$literalExpectation("}", false),
      peg$c27 = function(statements) { return tree.Body({ statements: statements.map(nth(0)).filter(notEmpty) }); },
      peg$c28 = function(statements) { return tree.FunctionBody({ statements: statements.map(nth(0)).filter(notEmpty) }); },
      peg$c29 = function(statement) { return statement; },
      peg$c30 = "var",
      peg$c31 = peg$literalExpectation("var", false),
      peg$c32 = "=",
      peg$c33 = peg$literalExpectation("=", false),
      peg$c34 = function(variableName, variableType, initialValue) {
              return tree.VariableDeclaration({
                  variableName,
                  variableType,
                  initialValue: get(initialValue, 2, null),
              });
          },
      peg$c35 = function() { },
      peg$c36 = "return",
      peg$c37 = peg$literalExpectation("return", false),
      peg$c38 = function(expression) { return tree.ReturnStatement({ expression }); },
      peg$c39 = "else",
      peg$c40 = peg$literalExpectation("else", false),
      peg$c41 = function(keyword, predicate, thenBranch, elseBranch) {
              predicate = keyword === 'unless'
                  ? tree.UnaryOperator({ operator: 'not', operand: predicate })
                  : predicate;

              return tree.ConditionalStatement({
                  predicate,
                  thenBranch,
                  elseBranch: get(elseBranch, 2, emptyBody),
              });
          },
      peg$c42 = function(keyword, predicate, body) {
              predicate = keyword === 'until'
                  ? tree.UnaryOperator({ operator: 'not', operand: predicate })
                  : predicate;

              return tree.LoopingStatement({
                  predicate,
                  body,
              });
          },
      peg$c43 = function(assembler) {
              return assembler;
          },
      peg$c44 = function(expression) { return tree.ExpressionStatement({ expression }); },
      peg$c45 = "asm",
      peg$c46 = peg$literalExpectation("asm", false),
      peg$c47 = "endasm",
      peg$c48 = peg$literalExpectation("endasm", false),
      peg$c49 = function(instructions) {
              return tree.InlineAssembler({ instructions: toString(instructions) });
          },
      peg$c50 = peg$anyExpectation(),
      peg$c51 = function(data) { return data; },
      peg$c52 = function() { return tree.EmptyInstruction(); },
      peg$c53 = ";",
      peg$c54 = peg$literalExpectation(";", false),
      peg$c55 = "*",
      peg$c56 = peg$literalExpectation("*", false),
      peg$c57 = function(type) { return tree.PointerType({ type }); },
      peg$c58 = "[",
      peg$c59 = peg$literalExpectation("[", false),
      peg$c60 = "]",
      peg$c61 = peg$literalExpectation("]", false),
      peg$c62 = function(capacity, type) { return tree.ArrayType({ type, capacity }); },
      peg$c63 = function(name) { return tree.NamedType({ name: String(name) }); },
      peg$c64 = function(binaryOperator) { return binaryOperator; },
      peg$c65 = function(head, tail) { return operatorsToTree({ head, tail }); },
      peg$c66 = function(original, followups) {
              let expression = original;
              for (let followup of followups) {
                  if (followup.kind === 'ArrayDereference') {
                      followup = tree.ArrayDereference({
                          array: expression,
                          offset: followup.offset,
                      });
                  } else if (followup.kind === 'FunctionApplication') {
                      followup = tree.FunctionApplication({
                          function: expression,
                          args: followup.args,
                      });
                  }

                  expression = followup;
              }

              return expression;
          },
      peg$c67 = function(expression) { return expression; },
      peg$c68 = function(operator, operand) { return tree.UnaryOperator({ operator, operand }); },
      peg$c69 = function(identifier) { return identifier; },
      peg$c70 = function(number) { return number; },
      peg$c71 = function(string) { return string; },
      peg$c72 = function(args) { return tree.FunctionApplication({ args }); },
      peg$c73 = function(offset) { return tree.ArrayDereference({ offset }); },
      peg$c74 = peg$otherExpectation("identifier"),
      peg$c75 = /^[a-zA-Z]/,
      peg$c76 = peg$classExpectation([["a", "z"], ["A", "Z"]], false, false),
      peg$c77 = /^[a-zA-Z0-9_\-]/,
      peg$c78 = peg$classExpectation([["a", "z"], ["A", "Z"], ["0", "9"], "_", "-"], false, false),
      peg$c79 = function(name) {
              name = toString(name);
              checkNotReserved(name);
              return tree.Identifier({
                  name: name,
                  toString: value(name),
              });
          },
      peg$c80 = "0x",
      peg$c81 = peg$literalExpectation("0x", false),
      peg$c82 = function(digits) { return tree.Number({ value: toInteger(digits, 16) }); },
      peg$c83 = "0b",
      peg$c84 = peg$literalExpectation("0b", false),
      peg$c85 = function(digits) { return tree.Number({ value: toInteger(digits, 2) }); },
      peg$c86 = function(digits) { return tree.Number({ value: toInteger(digits, 10) }); },
      peg$c87 = "'",
      peg$c88 = peg$literalExpectation("'", false),
      peg$c89 = function(c) { return tree.Number({ value: c.codePointAt() }); },
      peg$c90 = "\\\\",
      peg$c91 = peg$literalExpectation("\\\\", false),
      peg$c92 = function() { return "\\"; },
      peg$c93 = "\\'",
      peg$c94 = peg$literalExpectation("\\'", false),
      peg$c95 = function() { return "'"; },
      peg$c96 = "\\n",
      peg$c97 = peg$literalExpectation("\\n", false),
      peg$c98 = function() { return "\n"; },
      peg$c99 = "\\r",
      peg$c100 = peg$literalExpectation("\\r", false),
      peg$c101 = function() { return "\r"; },
      peg$c102 = "\\t",
      peg$c103 = peg$literalExpectation("\\t", false),
      peg$c104 = function() { return "\t"; },
      peg$c105 = "\\b",
      peg$c106 = peg$literalExpectation("\\b", false),
      peg$c107 = function() { return "\b"; },
      peg$c108 = "\\x",
      peg$c109 = peg$literalExpectation("\\x", false),
      peg$c110 = /^[0-9a-fA-F]/,
      peg$c111 = peg$classExpectation([["0", "9"], ["a", "f"], ["A", "F"]], false, false),
      peg$c112 = function(digits) { return String.fromCharCode(toInteger(digits, 16)); },
      peg$c113 = /^[^"]/,
      peg$c114 = peg$classExpectation(["\""], true, false),
      peg$c115 = function(c) { return c; },
      peg$c116 = "\"",
      peg$c117 = peg$literalExpectation("\"", false),
      peg$c118 = function(string) { return tree.String({ string: toString(string) }); },
      peg$c119 = "\\\"",
      peg$c120 = peg$literalExpectation("\\\"", false),
      peg$c121 = function() { return '"'; },
      peg$c122 = peg$otherExpectation("white space"),
      peg$c123 = /^[ \n\r\t]/,
      peg$c124 = peg$classExpectation([" ", "\n", "\r", "\t"], false, false),
      peg$c125 = "/*",
      peg$c126 = peg$literalExpectation("/*", false),
      peg$c127 = "*/",
      peg$c128 = peg$literalExpectation("*/", false),
      peg$c129 = "if",
      peg$c130 = peg$literalExpectation("if", false),
      peg$c131 = "unless",
      peg$c132 = peg$literalExpectation("unless", false),
      peg$c133 = "while",
      peg$c134 = peg$literalExpectation("while", false),
      peg$c135 = "until",
      peg$c136 = peg$literalExpectation("until", false),
      peg$c137 = "+",
      peg$c138 = peg$literalExpectation("+", false),
      peg$c139 = "-",
      peg$c140 = peg$literalExpectation("-", false),
      peg$c141 = "~",
      peg$c142 = peg$literalExpectation("~", false),
      peg$c143 = "not",
      peg$c144 = peg$literalExpectation("not", false),
      peg$c145 = "/",
      peg$c146 = peg$literalExpectation("/", false),
      peg$c147 = "mod",
      peg$c148 = peg$literalExpectation("mod", false),
      peg$c149 = "|",
      peg$c150 = peg$literalExpectation("|", false),
      peg$c151 = "&",
      peg$c152 = peg$literalExpectation("&", false),
      peg$c153 = "^",
      peg$c154 = peg$literalExpectation("^", false),
      peg$c155 = "shl",
      peg$c156 = peg$literalExpectation("shl", false),
      peg$c157 = "shr",
      peg$c158 = peg$literalExpectation("shr", false),
      peg$c159 = "==",
      peg$c160 = peg$literalExpectation("==", false),
      peg$c161 = "!=",
      peg$c162 = peg$literalExpectation("!=", false),
      peg$c163 = "<=",
      peg$c164 = peg$literalExpectation("<=", false),
      peg$c165 = ">=",
      peg$c166 = peg$literalExpectation(">=", false),
      peg$c167 = "<",
      peg$c168 = peg$literalExpectation("<", false),
      peg$c169 = ">",
      peg$c170 = peg$literalExpectation(">", false),
      peg$c171 = "and",
      peg$c172 = peg$literalExpectation("and", false),
      peg$c173 = "or",
      peg$c174 = peg$literalExpectation("or", false),
      peg$c175 = /^[0-9_]/,
      peg$c176 = peg$classExpectation([["0", "9"], "_"], false, false),
      peg$c177 = function(digits) { return toString(digits); },
      peg$c178 = /^[0-9a-fA-F_]/,
      peg$c179 = peg$classExpectation([["0", "9"], ["a", "f"], ["A", "F"], "_"], false, false),
      peg$c180 = /^[01_]/,
      peg$c181 = peg$classExpectation(["0", "1", "_"], false, false),

      peg$currPos          = 0,
      peg$savedPos         = 0,
      peg$posDetailsCache  = [{ line: 1, column: 1 }],
      peg$maxFailPos       = 0,
      peg$maxFailExpected  = [],
      peg$silentFails      = 0,

      peg$result;

  if ("startRule" in options) {
    if (!(options.startRule in peg$startRuleFunctions)) {
      throw new Error("Can't start parsing from rule \"" + options.startRule + "\".");
    }

    peg$startRuleFunction = peg$startRuleFunctions[options.startRule];
  }

  function text() {
    return input.substring(peg$savedPos, peg$currPos);
  }

  function location() {
    return peg$computeLocation(peg$savedPos, peg$currPos);
  }

  function expected(description, location) {
    location = location !== void 0 ? location : peg$computeLocation(peg$savedPos, peg$currPos)

    throw peg$buildStructuredError(
      [peg$otherExpectation(description)],
      input.substring(peg$savedPos, peg$currPos),
      location
    );
  }

  function error(message, location) {
    location = location !== void 0 ? location : peg$computeLocation(peg$savedPos, peg$currPos)

    throw peg$buildSimpleError(message, location);
  }

  function peg$literalExpectation(text, ignoreCase) {
    return { type: "literal", text: text, ignoreCase: ignoreCase };
  }

  function peg$classExpectation(parts, inverted, ignoreCase) {
    return { type: "class", parts: parts, inverted: inverted, ignoreCase: ignoreCase };
  }

  function peg$anyExpectation() {
    return { type: "any" };
  }

  function peg$endExpectation() {
    return { type: "end" };
  }

  function peg$otherExpectation(description) {
    return { type: "other", description: description };
  }

  function peg$computePosDetails(pos) {
    var details = peg$posDetailsCache[pos], p;

    if (details) {
      return details;
    } else {
      p = pos - 1;
      while (!peg$posDetailsCache[p]) {
        p--;
      }

      details = peg$posDetailsCache[p];
      details = {
        line:   details.line,
        column: details.column
      };

      while (p < pos) {
        if (input.charCodeAt(p) === 10) {
          details.line++;
          details.column = 1;
        } else {
          details.column++;
        }

        p++;
      }

      peg$posDetailsCache[pos] = details;
      return details;
    }
  }

  function peg$computeLocation(startPos, endPos) {
    var startPosDetails = peg$computePosDetails(startPos),
        endPosDetails   = peg$computePosDetails(endPos);

    return {
      start: {
        offset: startPos,
        line:   startPosDetails.line,
        column: startPosDetails.column
      },
      end: {
        offset: endPos,
        line:   endPosDetails.line,
        column: endPosDetails.column
      }
    };
  }

  function peg$fail(expected) {
    if (peg$currPos < peg$maxFailPos) { return; }

    if (peg$currPos > peg$maxFailPos) {
      peg$maxFailPos = peg$currPos;
      peg$maxFailExpected = [];
    }

    peg$maxFailExpected.push(expected);
  }

  function peg$buildSimpleError(message, location) {
    return new peg$SyntaxError(message, null, null, location);
  }

  function peg$buildStructuredError(expected, found, location) {
    return new peg$SyntaxError(
      peg$SyntaxError.buildMessage(expected, found),
      expected,
      found,
      location
    );
  }

  function peg$parseProgram() {
    var s0, s1, s2, s3, s4, s5;

    s0 = peg$currPos;
    s1 = peg$parse_();
    if (s1 !== peg$FAILED) {
      s2 = [];
      s3 = peg$currPos;
      s4 = peg$parseTopLevelStatement();
      if (s4 !== peg$FAILED) {
        s5 = peg$parse_();
        if (s5 !== peg$FAILED) {
          s4 = [s4, s5];
          s3 = s4;
        } else {
          peg$currPos = s3;
          s3 = peg$FAILED;
        }
      } else {
        peg$currPos = s3;
        s3 = peg$FAILED;
      }
      while (s3 !== peg$FAILED) {
        s2.push(s3);
        s3 = peg$currPos;
        s4 = peg$parseTopLevelStatement();
        if (s4 !== peg$FAILED) {
          s5 = peg$parse_();
          if (s5 !== peg$FAILED) {
            s4 = [s4, s5];
            s3 = s4;
          } else {
            peg$currPos = s3;
            s3 = peg$FAILED;
          }
        } else {
          peg$currPos = s3;
          s3 = peg$FAILED;
        }
      }
      if (s2 !== peg$FAILED) {
        s3 = peg$parse_();
        if (s3 !== peg$FAILED) {
          peg$savedPos = s0;
          s1 = peg$c0(s2);
          s0 = s1;
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }

    return s0;
  }

  function peg$parseTopLevelStatement() {
    var s0, s1;

    s0 = peg$currPos;
    s1 = peg$parseFunctionDeclaration();
    if (s1 !== peg$FAILED) {
      peg$savedPos = s0;
      s1 = peg$c1(s1);
    }
    s0 = s1;
    if (s0 === peg$FAILED) {
      s0 = peg$currPos;
      s1 = peg$parseFunctionDefinition();
      if (s1 !== peg$FAILED) {
        peg$savedPos = s0;
        s1 = peg$c2(s1);
      }
      s0 = s1;
      if (s0 === peg$FAILED) {
        s0 = peg$currPos;
        s1 = peg$parseVariableDeclaration();
        if (s1 !== peg$FAILED) {
          peg$savedPos = s0;
          s1 = peg$c1(s1);
        }
        s0 = s1;
      }
    }

    return s0;
  }

  function peg$parseFunctionDeclaration() {
    var s0, s1, s2, s3, s4, s5, s6, s7, s8, s9, s10, s11, s12;

    s0 = peg$currPos;
    if (input.substr(peg$currPos, 2) === peg$c3) {
      s1 = peg$c3;
      peg$currPos += 2;
    } else {
      s1 = peg$FAILED;
      if (peg$silentFails === 0) { peg$fail(peg$c4); }
    }
    if (s1 !== peg$FAILED) {
      s2 = peg$parse_();
      if (s2 !== peg$FAILED) {
        s3 = peg$parseCallingConventionSpecifier();
        if (s3 !== peg$FAILED) {
          s4 = peg$parse_();
          if (s4 !== peg$FAILED) {
            s5 = peg$parseIdentifier();
            if (s5 !== peg$FAILED) {
              s6 = peg$parse_();
              if (s6 !== peg$FAILED) {
                s7 = peg$parseParameterList();
                if (s7 !== peg$FAILED) {
                  s8 = peg$parse_();
                  if (s8 !== peg$FAILED) {
                    s9 = peg$parseType();
                    if (s9 !== peg$FAILED) {
                      s10 = peg$parse_();
                      if (s10 !== peg$FAILED) {
                        s11 = peg$parseStatementTerminator();
                        if (s11 !== peg$FAILED) {
                          s12 = peg$parse_();
                          if (s12 !== peg$FAILED) {
                            peg$savedPos = s0;
                            s1 = peg$c5(s3, s5, s7, s9);
                            s0 = s1;
                          } else {
                            peg$currPos = s0;
                            s0 = peg$FAILED;
                          }
                        } else {
                          peg$currPos = s0;
                          s0 = peg$FAILED;
                        }
                      } else {
                        peg$currPos = s0;
                        s0 = peg$FAILED;
                      }
                    } else {
                      peg$currPos = s0;
                      s0 = peg$FAILED;
                    }
                  } else {
                    peg$currPos = s0;
                    s0 = peg$FAILED;
                  }
                } else {
                  peg$currPos = s0;
                  s0 = peg$FAILED;
                }
              } else {
                peg$currPos = s0;
                s0 = peg$FAILED;
              }
            } else {
              peg$currPos = s0;
              s0 = peg$FAILED;
            }
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }

    return s0;
  }

  function peg$parseFunctionDefinition() {
    var s0, s1, s2, s3, s4, s5, s6, s7, s8, s9, s10, s11, s12;

    s0 = peg$currPos;
    if (input.substr(peg$currPos, 2) === peg$c3) {
      s1 = peg$c3;
      peg$currPos += 2;
    } else {
      s1 = peg$FAILED;
      if (peg$silentFails === 0) { peg$fail(peg$c4); }
    }
    if (s1 !== peg$FAILED) {
      s2 = peg$parse_();
      if (s2 !== peg$FAILED) {
        s3 = peg$parseCallingConventionSpecifier();
        if (s3 !== peg$FAILED) {
          s4 = peg$parse_();
          if (s4 !== peg$FAILED) {
            s5 = peg$parseIdentifier();
            if (s5 !== peg$FAILED) {
              s6 = peg$parse_();
              if (s6 !== peg$FAILED) {
                s7 = peg$parseParameterList();
                if (s7 !== peg$FAILED) {
                  s8 = peg$parse_();
                  if (s8 !== peg$FAILED) {
                    s9 = peg$parseType();
                    if (s9 !== peg$FAILED) {
                      s10 = peg$parse_();
                      if (s10 !== peg$FAILED) {
                        s11 = peg$parseFunctionBody();
                        if (s11 !== peg$FAILED) {
                          s12 = peg$parse_();
                          if (s12 !== peg$FAILED) {
                            peg$savedPos = s0;
                            s1 = peg$c6(s3, s5, s7, s9, s11);
                            s0 = s1;
                          } else {
                            peg$currPos = s0;
                            s0 = peg$FAILED;
                          }
                        } else {
                          peg$currPos = s0;
                          s0 = peg$FAILED;
                        }
                      } else {
                        peg$currPos = s0;
                        s0 = peg$FAILED;
                      }
                    } else {
                      peg$currPos = s0;
                      s0 = peg$FAILED;
                    }
                  } else {
                    peg$currPos = s0;
                    s0 = peg$FAILED;
                  }
                } else {
                  peg$currPos = s0;
                  s0 = peg$FAILED;
                }
              } else {
                peg$currPos = s0;
                s0 = peg$FAILED;
              }
            } else {
              peg$currPos = s0;
              s0 = peg$FAILED;
            }
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }

    return s0;
  }

  function peg$parseCallingConventionSpecifier() {
    var s0, s1, s2;

    s0 = peg$currPos;
    s1 = peg$parseCallingConventionName();
    if (s1 !== peg$FAILED) {
      s2 = peg$parse_();
      if (s2 !== peg$FAILED) {
        peg$savedPos = s0;
        s1 = peg$c7(s1);
        s0 = s1;
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }
    if (s0 === peg$FAILED) {
      s0 = peg$currPos;
      s1 = peg$parse_();
      if (s1 !== peg$FAILED) {
        peg$savedPos = s0;
        s1 = peg$c8();
      }
      s0 = s1;
    }

    return s0;
  }

  function peg$parseCallingConventionName() {
    var s0, s1;

    s0 = peg$currPos;
    if (input.substr(peg$currPos, 7) === peg$c9) {
      s1 = peg$c9;
      peg$currPos += 7;
    } else {
      s1 = peg$FAILED;
      if (peg$silentFails === 0) { peg$fail(peg$c10); }
    }
    if (s1 !== peg$FAILED) {
      peg$savedPos = s0;
      s1 = peg$c8();
    }
    s0 = s1;
    if (s0 === peg$FAILED) {
      s0 = peg$currPos;
      if (input.substr(peg$currPos, 8) === peg$c11) {
        s1 = peg$c11;
        peg$currPos += 8;
      } else {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c12); }
      }
      if (s1 !== peg$FAILED) {
        peg$savedPos = s0;
        s1 = peg$c13();
      }
      s0 = s1;
    }

    return s0;
  }

  function peg$parseParameterList() {
    var s0, s1, s2, s3, s4, s5, s6, s7, s8, s9;

    s0 = peg$currPos;
    if (input.charCodeAt(peg$currPos) === 40) {
      s1 = peg$c14;
      peg$currPos++;
    } else {
      s1 = peg$FAILED;
      if (peg$silentFails === 0) { peg$fail(peg$c15); }
    }
    if (s1 !== peg$FAILED) {
      s2 = peg$parse_();
      if (s2 !== peg$FAILED) {
        if (input.charCodeAt(peg$currPos) === 41) {
          s3 = peg$c16;
          peg$currPos++;
        } else {
          s3 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c17); }
        }
        if (s3 !== peg$FAILED) {
          s4 = peg$parse_();
          if (s4 !== peg$FAILED) {
            peg$savedPos = s0;
            s1 = peg$c18();
            s0 = s1;
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }
    if (s0 === peg$FAILED) {
      s0 = peg$currPos;
      if (input.charCodeAt(peg$currPos) === 40) {
        s1 = peg$c14;
        peg$currPos++;
      } else {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c15); }
      }
      if (s1 !== peg$FAILED) {
        s2 = peg$parse_();
        if (s2 !== peg$FAILED) {
          s3 = peg$parseNameTypePair();
          if (s3 !== peg$FAILED) {
            s4 = [];
            s5 = peg$currPos;
            s6 = peg$parse_();
            if (s6 !== peg$FAILED) {
              if (input.charCodeAt(peg$currPos) === 44) {
                s7 = peg$c19;
                peg$currPos++;
              } else {
                s7 = peg$FAILED;
                if (peg$silentFails === 0) { peg$fail(peg$c20); }
              }
              if (s7 !== peg$FAILED) {
                s8 = peg$parse_();
                if (s8 !== peg$FAILED) {
                  s9 = peg$parseNameTypePair();
                  if (s9 !== peg$FAILED) {
                    s6 = [s6, s7, s8, s9];
                    s5 = s6;
                  } else {
                    peg$currPos = s5;
                    s5 = peg$FAILED;
                  }
                } else {
                  peg$currPos = s5;
                  s5 = peg$FAILED;
                }
              } else {
                peg$currPos = s5;
                s5 = peg$FAILED;
              }
            } else {
              peg$currPos = s5;
              s5 = peg$FAILED;
            }
            while (s5 !== peg$FAILED) {
              s4.push(s5);
              s5 = peg$currPos;
              s6 = peg$parse_();
              if (s6 !== peg$FAILED) {
                if (input.charCodeAt(peg$currPos) === 44) {
                  s7 = peg$c19;
                  peg$currPos++;
                } else {
                  s7 = peg$FAILED;
                  if (peg$silentFails === 0) { peg$fail(peg$c20); }
                }
                if (s7 !== peg$FAILED) {
                  s8 = peg$parse_();
                  if (s8 !== peg$FAILED) {
                    s9 = peg$parseNameTypePair();
                    if (s9 !== peg$FAILED) {
                      s6 = [s6, s7, s8, s9];
                      s5 = s6;
                    } else {
                      peg$currPos = s5;
                      s5 = peg$FAILED;
                    }
                  } else {
                    peg$currPos = s5;
                    s5 = peg$FAILED;
                  }
                } else {
                  peg$currPos = s5;
                  s5 = peg$FAILED;
                }
              } else {
                peg$currPos = s5;
                s5 = peg$FAILED;
              }
            }
            if (s4 !== peg$FAILED) {
              s5 = peg$parse_();
              if (s5 !== peg$FAILED) {
                if (input.charCodeAt(peg$currPos) === 41) {
                  s6 = peg$c16;
                  peg$currPos++;
                } else {
                  s6 = peg$FAILED;
                  if (peg$silentFails === 0) { peg$fail(peg$c17); }
                }
                if (s6 !== peg$FAILED) {
                  s7 = peg$parse_();
                  if (s7 !== peg$FAILED) {
                    peg$savedPos = s0;
                    s1 = peg$c21(s3, s4);
                    s0 = s1;
                  } else {
                    peg$currPos = s0;
                    s0 = peg$FAILED;
                  }
                } else {
                  peg$currPos = s0;
                  s0 = peg$FAILED;
                }
              } else {
                peg$currPos = s0;
                s0 = peg$FAILED;
              }
            } else {
              peg$currPos = s0;
              s0 = peg$FAILED;
            }
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    }

    return s0;
  }

  function peg$parseNameTypePair() {
    var s0, s1, s2, s3;

    s0 = peg$currPos;
    s1 = peg$parseIdentifier();
    if (s1 !== peg$FAILED) {
      s2 = peg$parse__();
      if (s2 !== peg$FAILED) {
        s3 = peg$parseType();
        if (s3 !== peg$FAILED) {
          peg$savedPos = s0;
          s1 = peg$c22(s1, s3);
          s0 = s1;
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }

    return s0;
  }

  function peg$parseBody() {
    var s0, s1, s2, s3, s4, s5, s6;

    s0 = peg$currPos;
    if (input.charCodeAt(peg$currPos) === 123) {
      s1 = peg$c23;
      peg$currPos++;
    } else {
      s1 = peg$FAILED;
      if (peg$silentFails === 0) { peg$fail(peg$c24); }
    }
    if (s1 !== peg$FAILED) {
      s2 = peg$parse_();
      if (s2 !== peg$FAILED) {
        s3 = [];
        s4 = peg$currPos;
        s5 = peg$parseStatement();
        if (s5 !== peg$FAILED) {
          s6 = peg$parse_();
          if (s6 !== peg$FAILED) {
            s5 = [s5, s6];
            s4 = s5;
          } else {
            peg$currPos = s4;
            s4 = peg$FAILED;
          }
        } else {
          peg$currPos = s4;
          s4 = peg$FAILED;
        }
        while (s4 !== peg$FAILED) {
          s3.push(s4);
          s4 = peg$currPos;
          s5 = peg$parseStatement();
          if (s5 !== peg$FAILED) {
            s6 = peg$parse_();
            if (s6 !== peg$FAILED) {
              s5 = [s5, s6];
              s4 = s5;
            } else {
              peg$currPos = s4;
              s4 = peg$FAILED;
            }
          } else {
            peg$currPos = s4;
            s4 = peg$FAILED;
          }
        }
        if (s3 !== peg$FAILED) {
          if (input.charCodeAt(peg$currPos) === 125) {
            s4 = peg$c25;
            peg$currPos++;
          } else {
            s4 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c26); }
          }
          if (s4 !== peg$FAILED) {
            peg$savedPos = s0;
            s1 = peg$c27(s3);
            s0 = s1;
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }

    return s0;
  }

  function peg$parseFunctionBody() {
    var s0, s1, s2, s3, s4, s5, s6;

    s0 = peg$currPos;
    if (input.charCodeAt(peg$currPos) === 123) {
      s1 = peg$c23;
      peg$currPos++;
    } else {
      s1 = peg$FAILED;
      if (peg$silentFails === 0) { peg$fail(peg$c24); }
    }
    if (s1 !== peg$FAILED) {
      s2 = peg$parse_();
      if (s2 !== peg$FAILED) {
        s3 = [];
        s4 = peg$currPos;
        s5 = peg$parseFunctionStatement();
        if (s5 !== peg$FAILED) {
          s6 = peg$parse_();
          if (s6 !== peg$FAILED) {
            s5 = [s5, s6];
            s4 = s5;
          } else {
            peg$currPos = s4;
            s4 = peg$FAILED;
          }
        } else {
          peg$currPos = s4;
          s4 = peg$FAILED;
        }
        while (s4 !== peg$FAILED) {
          s3.push(s4);
          s4 = peg$currPos;
          s5 = peg$parseFunctionStatement();
          if (s5 !== peg$FAILED) {
            s6 = peg$parse_();
            if (s6 !== peg$FAILED) {
              s5 = [s5, s6];
              s4 = s5;
            } else {
              peg$currPos = s4;
              s4 = peg$FAILED;
            }
          } else {
            peg$currPos = s4;
            s4 = peg$FAILED;
          }
        }
        if (s3 !== peg$FAILED) {
          if (input.charCodeAt(peg$currPos) === 125) {
            s4 = peg$c25;
            peg$currPos++;
          } else {
            s4 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c26); }
          }
          if (s4 !== peg$FAILED) {
            peg$savedPos = s0;
            s1 = peg$c28(s3);
            s0 = s1;
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }

    return s0;
  }

  function peg$parseFunctionStatement() {
    var s0, s1;

    s0 = peg$currPos;
    s1 = peg$parseVariableDeclaration();
    if (s1 !== peg$FAILED) {
      peg$savedPos = s0;
      s1 = peg$c1(s1);
    }
    s0 = s1;
    if (s0 === peg$FAILED) {
      s0 = peg$currPos;
      s1 = peg$parseStatement();
      if (s1 !== peg$FAILED) {
        peg$savedPos = s0;
        s1 = peg$c29(s1);
      }
      s0 = s1;
    }

    return s0;
  }

  function peg$parseVariableDeclaration() {
    var s0, s1, s2, s3, s4, s5, s6, s7, s8, s9, s10;

    s0 = peg$currPos;
    if (input.substr(peg$currPos, 3) === peg$c30) {
      s1 = peg$c30;
      peg$currPos += 3;
    } else {
      s1 = peg$FAILED;
      if (peg$silentFails === 0) { peg$fail(peg$c31); }
    }
    if (s1 !== peg$FAILED) {
      s2 = peg$parse__();
      if (s2 !== peg$FAILED) {
        s3 = peg$parseIdentifier();
        if (s3 !== peg$FAILED) {
          s4 = peg$parse__();
          if (s4 !== peg$FAILED) {
            s5 = peg$parseType();
            if (s5 !== peg$FAILED) {
              s6 = peg$parse_();
              if (s6 !== peg$FAILED) {
                s7 = peg$currPos;
                if (input.charCodeAt(peg$currPos) === 61) {
                  s8 = peg$c32;
                  peg$currPos++;
                } else {
                  s8 = peg$FAILED;
                  if (peg$silentFails === 0) { peg$fail(peg$c33); }
                }
                if (s8 !== peg$FAILED) {
                  s9 = peg$parse_();
                  if (s9 !== peg$FAILED) {
                    s10 = peg$parseExpression();
                    if (s10 !== peg$FAILED) {
                      s8 = [s8, s9, s10];
                      s7 = s8;
                    } else {
                      peg$currPos = s7;
                      s7 = peg$FAILED;
                    }
                  } else {
                    peg$currPos = s7;
                    s7 = peg$FAILED;
                  }
                } else {
                  peg$currPos = s7;
                  s7 = peg$FAILED;
                }
                if (s7 === peg$FAILED) {
                  s7 = null;
                }
                if (s7 !== peg$FAILED) {
                  s8 = peg$parse_();
                  if (s8 !== peg$FAILED) {
                    s9 = peg$parseStatementTerminator();
                    if (s9 !== peg$FAILED) {
                      peg$savedPos = s0;
                      s1 = peg$c34(s3, s5, s7);
                      s0 = s1;
                    } else {
                      peg$currPos = s0;
                      s0 = peg$FAILED;
                    }
                  } else {
                    peg$currPos = s0;
                    s0 = peg$FAILED;
                  }
                } else {
                  peg$currPos = s0;
                  s0 = peg$FAILED;
                }
              } else {
                peg$currPos = s0;
                s0 = peg$FAILED;
              }
            } else {
              peg$currPos = s0;
              s0 = peg$FAILED;
            }
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }

    return s0;
  }

  function peg$parseStatement() {
    var s0, s1, s2, s3, s4, s5, s6, s7, s8, s9, s10;

    s0 = peg$currPos;
    s1 = peg$parseComment();
    if (s1 !== peg$FAILED) {
      peg$savedPos = s0;
      s1 = peg$c35();
    }
    s0 = s1;
    if (s0 === peg$FAILED) {
      s0 = peg$parseEmptyStatement();
      if (s0 === peg$FAILED) {
        s0 = peg$currPos;
        if (input.substr(peg$currPos, 6) === peg$c36) {
          s1 = peg$c36;
          peg$currPos += 6;
        } else {
          s1 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c37); }
        }
        if (s1 !== peg$FAILED) {
          s2 = peg$parse_();
          if (s2 !== peg$FAILED) {
            s3 = peg$parseExpression();
            if (s3 !== peg$FAILED) {
              s4 = peg$parse_();
              if (s4 !== peg$FAILED) {
                s5 = peg$parseStatementTerminator();
                if (s5 !== peg$FAILED) {
                  peg$savedPos = s0;
                  s1 = peg$c38(s3);
                  s0 = s1;
                } else {
                  peg$currPos = s0;
                  s0 = peg$FAILED;
                }
              } else {
                peg$currPos = s0;
                s0 = peg$FAILED;
              }
            } else {
              peg$currPos = s0;
              s0 = peg$FAILED;
            }
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
        if (s0 === peg$FAILED) {
          s0 = peg$currPos;
          s1 = peg$parseConditionalKeyword();
          if (s1 !== peg$FAILED) {
            s2 = peg$parse_();
            if (s2 !== peg$FAILED) {
              s3 = peg$parseExpression();
              if (s3 !== peg$FAILED) {
                s4 = peg$parse_();
                if (s4 !== peg$FAILED) {
                  s5 = peg$parseBody();
                  if (s5 !== peg$FAILED) {
                    s6 = peg$parse_();
                    if (s6 !== peg$FAILED) {
                      s7 = peg$currPos;
                      if (input.substr(peg$currPos, 4) === peg$c39) {
                        s8 = peg$c39;
                        peg$currPos += 4;
                      } else {
                        s8 = peg$FAILED;
                        if (peg$silentFails === 0) { peg$fail(peg$c40); }
                      }
                      if (s8 !== peg$FAILED) {
                        s9 = peg$parse_();
                        if (s9 !== peg$FAILED) {
                          s10 = peg$parseBody();
                          if (s10 !== peg$FAILED) {
                            s8 = [s8, s9, s10];
                            s7 = s8;
                          } else {
                            peg$currPos = s7;
                            s7 = peg$FAILED;
                          }
                        } else {
                          peg$currPos = s7;
                          s7 = peg$FAILED;
                        }
                      } else {
                        peg$currPos = s7;
                        s7 = peg$FAILED;
                      }
                      if (s7 === peg$FAILED) {
                        s7 = null;
                      }
                      if (s7 !== peg$FAILED) {
                        peg$savedPos = s0;
                        s1 = peg$c41(s1, s3, s5, s7);
                        s0 = s1;
                      } else {
                        peg$currPos = s0;
                        s0 = peg$FAILED;
                      }
                    } else {
                      peg$currPos = s0;
                      s0 = peg$FAILED;
                    }
                  } else {
                    peg$currPos = s0;
                    s0 = peg$FAILED;
                  }
                } else {
                  peg$currPos = s0;
                  s0 = peg$FAILED;
                }
              } else {
                peg$currPos = s0;
                s0 = peg$FAILED;
              }
            } else {
              peg$currPos = s0;
              s0 = peg$FAILED;
            }
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
          if (s0 === peg$FAILED) {
            s0 = peg$currPos;
            s1 = peg$parseLoopingKeyword();
            if (s1 !== peg$FAILED) {
              s2 = peg$parse_();
              if (s2 !== peg$FAILED) {
                s3 = peg$parseExpression();
                if (s3 !== peg$FAILED) {
                  s4 = peg$parse_();
                  if (s4 !== peg$FAILED) {
                    s5 = peg$parseBody();
                    if (s5 !== peg$FAILED) {
                      peg$savedPos = s0;
                      s1 = peg$c42(s1, s3, s5);
                      s0 = s1;
                    } else {
                      peg$currPos = s0;
                      s0 = peg$FAILED;
                    }
                  } else {
                    peg$currPos = s0;
                    s0 = peg$FAILED;
                  }
                } else {
                  peg$currPos = s0;
                  s0 = peg$FAILED;
                }
              } else {
                peg$currPos = s0;
                s0 = peg$FAILED;
              }
            } else {
              peg$currPos = s0;
              s0 = peg$FAILED;
            }
            if (s0 === peg$FAILED) {
              s0 = peg$currPos;
              s1 = peg$parseInlineAssembler();
              if (s1 !== peg$FAILED) {
                peg$savedPos = s0;
                s1 = peg$c43(s1);
              }
              s0 = s1;
              if (s0 === peg$FAILED) {
                s0 = peg$currPos;
                s1 = peg$parseExpression();
                if (s1 !== peg$FAILED) {
                  s2 = peg$parse_();
                  if (s2 !== peg$FAILED) {
                    s3 = peg$parseStatementTerminator();
                    if (s3 !== peg$FAILED) {
                      peg$savedPos = s0;
                      s1 = peg$c44(s1);
                      s0 = s1;
                    } else {
                      peg$currPos = s0;
                      s0 = peg$FAILED;
                    }
                  } else {
                    peg$currPos = s0;
                    s0 = peg$FAILED;
                  }
                } else {
                  peg$currPos = s0;
                  s0 = peg$FAILED;
                }
              }
            }
          }
        }
      }
    }

    return s0;
  }

  function peg$parseInlineAssembler() {
    var s0, s1, s2, s3, s4;

    s0 = peg$currPos;
    if (input.substr(peg$currPos, 3) === peg$c45) {
      s1 = peg$c45;
      peg$currPos += 3;
    } else {
      s1 = peg$FAILED;
      if (peg$silentFails === 0) { peg$fail(peg$c46); }
    }
    if (s1 !== peg$FAILED) {
      s2 = [];
      s3 = peg$parseAssemblerInstruction();
      while (s3 !== peg$FAILED) {
        s2.push(s3);
        s3 = peg$parseAssemblerInstruction();
      }
      if (s2 !== peg$FAILED) {
        if (input.substr(peg$currPos, 6) === peg$c47) {
          s3 = peg$c47;
          peg$currPos += 6;
        } else {
          s3 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c48); }
        }
        if (s3 !== peg$FAILED) {
          s4 = peg$parse_();
          if (s4 !== peg$FAILED) {
            peg$savedPos = s0;
            s1 = peg$c49(s2);
            s0 = s1;
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }

    return s0;
  }

  function peg$parseAssemblerInstruction() {
    var s0, s1, s2;

    s0 = peg$currPos;
    s1 = peg$currPos;
    peg$silentFails++;
    if (input.substr(peg$currPos, 6) === peg$c47) {
      s2 = peg$c47;
      peg$currPos += 6;
    } else {
      s2 = peg$FAILED;
      if (peg$silentFails === 0) { peg$fail(peg$c48); }
    }
    peg$silentFails--;
    if (s2 === peg$FAILED) {
      s1 = void 0;
    } else {
      peg$currPos = s1;
      s1 = peg$FAILED;
    }
    if (s1 !== peg$FAILED) {
      if (input.length > peg$currPos) {
        s2 = input.charAt(peg$currPos);
        peg$currPos++;
      } else {
        s2 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c50); }
      }
      if (s2 !== peg$FAILED) {
        peg$savedPos = s0;
        s1 = peg$c51(s2);
        s0 = s1;
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }

    return s0;
  }

  function peg$parseEmptyStatement() {
    var s0, s1;

    s0 = peg$currPos;
    s1 = peg$parseStatementTerminator();
    if (s1 !== peg$FAILED) {
      peg$savedPos = s0;
      s1 = peg$c52();
    }
    s0 = s1;

    return s0;
  }

  function peg$parseStatementTerminator() {
    var s0;

    if (input.charCodeAt(peg$currPos) === 59) {
      s0 = peg$c53;
      peg$currPos++;
    } else {
      s0 = peg$FAILED;
      if (peg$silentFails === 0) { peg$fail(peg$c54); }
    }

    return s0;
  }

  function peg$parseType() {
    var s0, s1, s2, s3, s4, s5, s6;

    s0 = peg$currPos;
    if (input.charCodeAt(peg$currPos) === 42) {
      s1 = peg$c55;
      peg$currPos++;
    } else {
      s1 = peg$FAILED;
      if (peg$silentFails === 0) { peg$fail(peg$c56); }
    }
    if (s1 !== peg$FAILED) {
      s2 = peg$parse_();
      if (s2 !== peg$FAILED) {
        s3 = peg$parseType();
        if (s3 !== peg$FAILED) {
          s4 = peg$parse_();
          if (s4 !== peg$FAILED) {
            peg$savedPos = s0;
            s1 = peg$c57(s3);
            s0 = s1;
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }
    if (s0 === peg$FAILED) {
      s0 = peg$currPos;
      if (input.charCodeAt(peg$currPos) === 91) {
        s1 = peg$c58;
        peg$currPos++;
      } else {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c59); }
      }
      if (s1 !== peg$FAILED) {
        s2 = peg$parseNumber();
        if (s2 !== peg$FAILED) {
          if (input.charCodeAt(peg$currPos) === 93) {
            s3 = peg$c60;
            peg$currPos++;
          } else {
            s3 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c61); }
          }
          if (s3 !== peg$FAILED) {
            s4 = peg$parse_();
            if (s4 !== peg$FAILED) {
              s5 = peg$parseType();
              if (s5 !== peg$FAILED) {
                s6 = peg$parse_();
                if (s6 !== peg$FAILED) {
                  peg$savedPos = s0;
                  s1 = peg$c62(s2, s5);
                  s0 = s1;
                } else {
                  peg$currPos = s0;
                  s0 = peg$FAILED;
                }
              } else {
                peg$currPos = s0;
                s0 = peg$FAILED;
              }
            } else {
              peg$currPos = s0;
              s0 = peg$FAILED;
            }
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
      if (s0 === peg$FAILED) {
        s0 = peg$currPos;
        s1 = peg$parseIdentifier();
        if (s1 !== peg$FAILED) {
          peg$savedPos = s0;
          s1 = peg$c63(s1);
        }
        s0 = s1;
      }
    }

    return s0;
  }

  function peg$parseExpression() {
    var s0, s1;

    s0 = peg$currPos;
    s1 = peg$parseBinaryOperator();
    if (s1 !== peg$FAILED) {
      peg$savedPos = s0;
      s1 = peg$c64(s1);
    }
    s0 = s1;

    return s0;
  }

  function peg$parseBinaryOperator() {
    var s0, s1, s2, s3, s4, s5, s6, s7;

    s0 = peg$currPos;
    s1 = peg$parsePrimaryExpression();
    if (s1 !== peg$FAILED) {
      s2 = [];
      s3 = peg$currPos;
      s4 = peg$parse_();
      if (s4 !== peg$FAILED) {
        s5 = peg$parseBinaryToken();
        if (s5 !== peg$FAILED) {
          s6 = peg$parse_();
          if (s6 !== peg$FAILED) {
            s7 = peg$parsePrimaryExpression();
            if (s7 !== peg$FAILED) {
              s4 = [s4, s5, s6, s7];
              s3 = s4;
            } else {
              peg$currPos = s3;
              s3 = peg$FAILED;
            }
          } else {
            peg$currPos = s3;
            s3 = peg$FAILED;
          }
        } else {
          peg$currPos = s3;
          s3 = peg$FAILED;
        }
      } else {
        peg$currPos = s3;
        s3 = peg$FAILED;
      }
      while (s3 !== peg$FAILED) {
        s2.push(s3);
        s3 = peg$currPos;
        s4 = peg$parse_();
        if (s4 !== peg$FAILED) {
          s5 = peg$parseBinaryToken();
          if (s5 !== peg$FAILED) {
            s6 = peg$parse_();
            if (s6 !== peg$FAILED) {
              s7 = peg$parsePrimaryExpression();
              if (s7 !== peg$FAILED) {
                s4 = [s4, s5, s6, s7];
                s3 = s4;
              } else {
                peg$currPos = s3;
                s3 = peg$FAILED;
              }
            } else {
              peg$currPos = s3;
              s3 = peg$FAILED;
            }
          } else {
            peg$currPos = s3;
            s3 = peg$FAILED;
          }
        } else {
          peg$currPos = s3;
          s3 = peg$FAILED;
        }
      }
      if (s2 !== peg$FAILED) {
        peg$savedPos = s0;
        s1 = peg$c65(s1, s2);
        s0 = s1;
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }

    return s0;
  }

  function peg$parsePrimaryExpression() {
    var s0, s1, s2, s3;

    s0 = peg$currPos;
    s1 = peg$parseSecondaryExpression();
    if (s1 !== peg$FAILED) {
      s2 = [];
      s3 = peg$parseSecondaryExpressionFollowup();
      while (s3 !== peg$FAILED) {
        s2.push(s3);
        s3 = peg$parseSecondaryExpressionFollowup();
      }
      if (s2 !== peg$FAILED) {
        peg$savedPos = s0;
        s1 = peg$c66(s1, s2);
        s0 = s1;
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }

    return s0;
  }

  function peg$parseSecondaryExpression() {
    var s0, s1, s2, s3, s4, s5;

    s0 = peg$currPos;
    if (input.charCodeAt(peg$currPos) === 40) {
      s1 = peg$c14;
      peg$currPos++;
    } else {
      s1 = peg$FAILED;
      if (peg$silentFails === 0) { peg$fail(peg$c15); }
    }
    if (s1 !== peg$FAILED) {
      s2 = peg$parse_();
      if (s2 !== peg$FAILED) {
        s3 = peg$parseExpression();
        if (s3 !== peg$FAILED) {
          s4 = peg$parse_();
          if (s4 !== peg$FAILED) {
            if (input.charCodeAt(peg$currPos) === 41) {
              s5 = peg$c16;
              peg$currPos++;
            } else {
              s5 = peg$FAILED;
              if (peg$silentFails === 0) { peg$fail(peg$c17); }
            }
            if (s5 !== peg$FAILED) {
              peg$savedPos = s0;
              s1 = peg$c67(s3);
              s0 = s1;
            } else {
              peg$currPos = s0;
              s0 = peg$FAILED;
            }
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }
    if (s0 === peg$FAILED) {
      s0 = peg$currPos;
      s1 = peg$parseUnaryToken();
      if (s1 !== peg$FAILED) {
        s2 = peg$parse_();
        if (s2 !== peg$FAILED) {
          s3 = peg$parsePrimaryExpression();
          if (s3 !== peg$FAILED) {
            peg$savedPos = s0;
            s1 = peg$c68(s1, s3);
            s0 = s1;
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
      if (s0 === peg$FAILED) {
        s0 = peg$currPos;
        s1 = peg$parseIdentifier();
        if (s1 !== peg$FAILED) {
          peg$savedPos = s0;
          s1 = peg$c69(s1);
        }
        s0 = s1;
        if (s0 === peg$FAILED) {
          s0 = peg$currPos;
          s1 = peg$parseNumber();
          if (s1 !== peg$FAILED) {
            peg$savedPos = s0;
            s1 = peg$c70(s1);
          }
          s0 = s1;
          if (s0 === peg$FAILED) {
            s0 = peg$currPos;
            s1 = peg$parseString();
            if (s1 !== peg$FAILED) {
              peg$savedPos = s0;
              s1 = peg$c71(s1);
            }
            s0 = s1;
          }
        }
      }
    }

    return s0;
  }

  function peg$parseSecondaryExpressionFollowup() {
    var s0, s1, s2, s3, s4;

    s0 = peg$currPos;
    s1 = peg$parseArgumentList();
    if (s1 !== peg$FAILED) {
      peg$savedPos = s0;
      s1 = peg$c72(s1);
    }
    s0 = s1;
    if (s0 === peg$FAILED) {
      s0 = peg$currPos;
      if (input.charCodeAt(peg$currPos) === 91) {
        s1 = peg$c58;
        peg$currPos++;
      } else {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c59); }
      }
      if (s1 !== peg$FAILED) {
        s2 = peg$parse_();
        if (s2 !== peg$FAILED) {
          s3 = peg$parsePrimaryExpression();
          if (s3 !== peg$FAILED) {
            if (input.charCodeAt(peg$currPos) === 93) {
              s4 = peg$c60;
              peg$currPos++;
            } else {
              s4 = peg$FAILED;
              if (peg$silentFails === 0) { peg$fail(peg$c61); }
            }
            if (s4 !== peg$FAILED) {
              peg$savedPos = s0;
              s1 = peg$c73(s3);
              s0 = s1;
            } else {
              peg$currPos = s0;
              s0 = peg$FAILED;
            }
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    }

    return s0;
  }

  function peg$parseArgumentList() {
    var s0, s1, s2, s3, s4, s5, s6, s7, s8, s9;

    s0 = peg$currPos;
    if (input.charCodeAt(peg$currPos) === 40) {
      s1 = peg$c14;
      peg$currPos++;
    } else {
      s1 = peg$FAILED;
      if (peg$silentFails === 0) { peg$fail(peg$c15); }
    }
    if (s1 !== peg$FAILED) {
      s2 = peg$parse_();
      if (s2 !== peg$FAILED) {
        if (input.charCodeAt(peg$currPos) === 41) {
          s3 = peg$c16;
          peg$currPos++;
        } else {
          s3 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c17); }
        }
        if (s3 !== peg$FAILED) {
          peg$savedPos = s0;
          s1 = peg$c18();
          s0 = s1;
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }
    if (s0 === peg$FAILED) {
      s0 = peg$currPos;
      if (input.charCodeAt(peg$currPos) === 40) {
        s1 = peg$c14;
        peg$currPos++;
      } else {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c15); }
      }
      if (s1 !== peg$FAILED) {
        s2 = peg$parse_();
        if (s2 !== peg$FAILED) {
          s3 = peg$parseExpression();
          if (s3 !== peg$FAILED) {
            s4 = [];
            s5 = peg$currPos;
            s6 = peg$parse_();
            if (s6 !== peg$FAILED) {
              if (input.charCodeAt(peg$currPos) === 44) {
                s7 = peg$c19;
                peg$currPos++;
              } else {
                s7 = peg$FAILED;
                if (peg$silentFails === 0) { peg$fail(peg$c20); }
              }
              if (s7 !== peg$FAILED) {
                s8 = peg$parse_();
                if (s8 !== peg$FAILED) {
                  s9 = peg$parseExpression();
                  if (s9 !== peg$FAILED) {
                    s6 = [s6, s7, s8, s9];
                    s5 = s6;
                  } else {
                    peg$currPos = s5;
                    s5 = peg$FAILED;
                  }
                } else {
                  peg$currPos = s5;
                  s5 = peg$FAILED;
                }
              } else {
                peg$currPos = s5;
                s5 = peg$FAILED;
              }
            } else {
              peg$currPos = s5;
              s5 = peg$FAILED;
            }
            while (s5 !== peg$FAILED) {
              s4.push(s5);
              s5 = peg$currPos;
              s6 = peg$parse_();
              if (s6 !== peg$FAILED) {
                if (input.charCodeAt(peg$currPos) === 44) {
                  s7 = peg$c19;
                  peg$currPos++;
                } else {
                  s7 = peg$FAILED;
                  if (peg$silentFails === 0) { peg$fail(peg$c20); }
                }
                if (s7 !== peg$FAILED) {
                  s8 = peg$parse_();
                  if (s8 !== peg$FAILED) {
                    s9 = peg$parseExpression();
                    if (s9 !== peg$FAILED) {
                      s6 = [s6, s7, s8, s9];
                      s5 = s6;
                    } else {
                      peg$currPos = s5;
                      s5 = peg$FAILED;
                    }
                  } else {
                    peg$currPos = s5;
                    s5 = peg$FAILED;
                  }
                } else {
                  peg$currPos = s5;
                  s5 = peg$FAILED;
                }
              } else {
                peg$currPos = s5;
                s5 = peg$FAILED;
              }
            }
            if (s4 !== peg$FAILED) {
              s5 = peg$parse_();
              if (s5 !== peg$FAILED) {
                if (input.charCodeAt(peg$currPos) === 41) {
                  s6 = peg$c16;
                  peg$currPos++;
                } else {
                  s6 = peg$FAILED;
                  if (peg$silentFails === 0) { peg$fail(peg$c17); }
                }
                if (s6 !== peg$FAILED) {
                  s7 = peg$parse_();
                  if (s7 !== peg$FAILED) {
                    peg$savedPos = s0;
                    s1 = peg$c21(s3, s4);
                    s0 = s1;
                  } else {
                    peg$currPos = s0;
                    s0 = peg$FAILED;
                  }
                } else {
                  peg$currPos = s0;
                  s0 = peg$FAILED;
                }
              } else {
                peg$currPos = s0;
                s0 = peg$FAILED;
              }
            } else {
              peg$currPos = s0;
              s0 = peg$FAILED;
            }
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    }

    return s0;
  }

  function peg$parseIdentifier() {
    var s0, s1, s2, s3, s4;

    peg$silentFails++;
    s0 = peg$currPos;
    s1 = peg$currPos;
    if (peg$c75.test(input.charAt(peg$currPos))) {
      s2 = input.charAt(peg$currPos);
      peg$currPos++;
    } else {
      s2 = peg$FAILED;
      if (peg$silentFails === 0) { peg$fail(peg$c76); }
    }
    if (s2 !== peg$FAILED) {
      s3 = [];
      if (peg$c77.test(input.charAt(peg$currPos))) {
        s4 = input.charAt(peg$currPos);
        peg$currPos++;
      } else {
        s4 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c78); }
      }
      while (s4 !== peg$FAILED) {
        s3.push(s4);
        if (peg$c77.test(input.charAt(peg$currPos))) {
          s4 = input.charAt(peg$currPos);
          peg$currPos++;
        } else {
          s4 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c78); }
        }
      }
      if (s3 !== peg$FAILED) {
        s2 = [s2, s3];
        s1 = s2;
      } else {
        peg$currPos = s1;
        s1 = peg$FAILED;
      }
    } else {
      peg$currPos = s1;
      s1 = peg$FAILED;
    }
    if (s1 !== peg$FAILED) {
      peg$savedPos = s0;
      s1 = peg$c79(s1);
    }
    s0 = s1;
    peg$silentFails--;
    if (s0 === peg$FAILED) {
      s1 = peg$FAILED;
      if (peg$silentFails === 0) { peg$fail(peg$c74); }
    }

    return s0;
  }

  function peg$parseNumber() {
    var s0, s1, s2, s3;

    s0 = peg$currPos;
    if (input.substr(peg$currPos, 2) === peg$c80) {
      s1 = peg$c80;
      peg$currPos += 2;
    } else {
      s1 = peg$FAILED;
      if (peg$silentFails === 0) { peg$fail(peg$c81); }
    }
    if (s1 !== peg$FAILED) {
      s2 = peg$parseHexadecimalDigits();
      if (s2 !== peg$FAILED) {
        peg$savedPos = s0;
        s1 = peg$c82(s2);
        s0 = s1;
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }
    if (s0 === peg$FAILED) {
      s0 = peg$currPos;
      if (input.substr(peg$currPos, 2) === peg$c83) {
        s1 = peg$c83;
        peg$currPos += 2;
      } else {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c84); }
      }
      if (s1 !== peg$FAILED) {
        s2 = peg$parseBinaryDigits();
        if (s2 !== peg$FAILED) {
          peg$savedPos = s0;
          s1 = peg$c85(s2);
          s0 = s1;
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
      if (s0 === peg$FAILED) {
        s0 = peg$currPos;
        s1 = peg$parseDigits();
        if (s1 !== peg$FAILED) {
          peg$savedPos = s0;
          s1 = peg$c86(s1);
        }
        s0 = s1;
        if (s0 === peg$FAILED) {
          s0 = peg$currPos;
          if (input.charCodeAt(peg$currPos) === 39) {
            s1 = peg$c87;
            peg$currPos++;
          } else {
            s1 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c88); }
          }
          if (s1 !== peg$FAILED) {
            s2 = peg$parseStandaloneCharacter();
            if (s2 !== peg$FAILED) {
              if (input.charCodeAt(peg$currPos) === 39) {
                s3 = peg$c87;
                peg$currPos++;
              } else {
                s3 = peg$FAILED;
                if (peg$silentFails === 0) { peg$fail(peg$c88); }
              }
              if (s3 !== peg$FAILED) {
                peg$savedPos = s0;
                s1 = peg$c89(s2);
                s0 = s1;
              } else {
                peg$currPos = s0;
                s0 = peg$FAILED;
              }
            } else {
              peg$currPos = s0;
              s0 = peg$FAILED;
            }
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        }
      }
    }

    return s0;
  }

  function peg$parseStandaloneCharacter() {
    var s0, s1, s2, s3, s4;

    s0 = peg$currPos;
    if (input.substr(peg$currPos, 2) === peg$c90) {
      s1 = peg$c90;
      peg$currPos += 2;
    } else {
      s1 = peg$FAILED;
      if (peg$silentFails === 0) { peg$fail(peg$c91); }
    }
    if (s1 !== peg$FAILED) {
      peg$savedPos = s0;
      s1 = peg$c92();
    }
    s0 = s1;
    if (s0 === peg$FAILED) {
      s0 = peg$currPos;
      if (input.substr(peg$currPos, 2) === peg$c93) {
        s1 = peg$c93;
        peg$currPos += 2;
      } else {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c94); }
      }
      if (s1 !== peg$FAILED) {
        peg$savedPos = s0;
        s1 = peg$c95();
      }
      s0 = s1;
      if (s0 === peg$FAILED) {
        s0 = peg$currPos;
        if (input.substr(peg$currPos, 2) === peg$c96) {
          s1 = peg$c96;
          peg$currPos += 2;
        } else {
          s1 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c97); }
        }
        if (s1 !== peg$FAILED) {
          peg$savedPos = s0;
          s1 = peg$c98();
        }
        s0 = s1;
        if (s0 === peg$FAILED) {
          s0 = peg$currPos;
          if (input.substr(peg$currPos, 2) === peg$c99) {
            s1 = peg$c99;
            peg$currPos += 2;
          } else {
            s1 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c100); }
          }
          if (s1 !== peg$FAILED) {
            peg$savedPos = s0;
            s1 = peg$c101();
          }
          s0 = s1;
          if (s0 === peg$FAILED) {
            s0 = peg$currPos;
            if (input.substr(peg$currPos, 2) === peg$c102) {
              s1 = peg$c102;
              peg$currPos += 2;
            } else {
              s1 = peg$FAILED;
              if (peg$silentFails === 0) { peg$fail(peg$c103); }
            }
            if (s1 !== peg$FAILED) {
              peg$savedPos = s0;
              s1 = peg$c104();
            }
            s0 = s1;
            if (s0 === peg$FAILED) {
              s0 = peg$currPos;
              if (input.substr(peg$currPos, 2) === peg$c105) {
                s1 = peg$c105;
                peg$currPos += 2;
              } else {
                s1 = peg$FAILED;
                if (peg$silentFails === 0) { peg$fail(peg$c106); }
              }
              if (s1 !== peg$FAILED) {
                peg$savedPos = s0;
                s1 = peg$c107();
              }
              s0 = s1;
              if (s0 === peg$FAILED) {
                s0 = peg$currPos;
                if (input.substr(peg$currPos, 2) === peg$c108) {
                  s1 = peg$c108;
                  peg$currPos += 2;
                } else {
                  s1 = peg$FAILED;
                  if (peg$silentFails === 0) { peg$fail(peg$c109); }
                }
                if (s1 !== peg$FAILED) {
                  s2 = peg$currPos;
                  if (peg$c110.test(input.charAt(peg$currPos))) {
                    s3 = input.charAt(peg$currPos);
                    peg$currPos++;
                  } else {
                    s3 = peg$FAILED;
                    if (peg$silentFails === 0) { peg$fail(peg$c111); }
                  }
                  if (s3 !== peg$FAILED) {
                    if (peg$c110.test(input.charAt(peg$currPos))) {
                      s4 = input.charAt(peg$currPos);
                      peg$currPos++;
                    } else {
                      s4 = peg$FAILED;
                      if (peg$silentFails === 0) { peg$fail(peg$c111); }
                    }
                    if (s4 !== peg$FAILED) {
                      s3 = [s3, s4];
                      s2 = s3;
                    } else {
                      peg$currPos = s2;
                      s2 = peg$FAILED;
                    }
                  } else {
                    peg$currPos = s2;
                    s2 = peg$FAILED;
                  }
                  if (s2 !== peg$FAILED) {
                    peg$savedPos = s0;
                    s1 = peg$c112(s2);
                    s0 = s1;
                  } else {
                    peg$currPos = s0;
                    s0 = peg$FAILED;
                  }
                } else {
                  peg$currPos = s0;
                  s0 = peg$FAILED;
                }
                if (s0 === peg$FAILED) {
                  s0 = peg$currPos;
                  if (peg$c113.test(input.charAt(peg$currPos))) {
                    s1 = input.charAt(peg$currPos);
                    peg$currPos++;
                  } else {
                    s1 = peg$FAILED;
                    if (peg$silentFails === 0) { peg$fail(peg$c114); }
                  }
                  if (s1 !== peg$FAILED) {
                    peg$savedPos = s0;
                    s1 = peg$c115(s1);
                  }
                  s0 = s1;
                }
              }
            }
          }
        }
      }
    }

    return s0;
  }

  function peg$parseString() {
    var s0, s1, s2, s3;

    s0 = peg$currPos;
    if (input.charCodeAt(peg$currPos) === 34) {
      s1 = peg$c116;
      peg$currPos++;
    } else {
      s1 = peg$FAILED;
      if (peg$silentFails === 0) { peg$fail(peg$c117); }
    }
    if (s1 !== peg$FAILED) {
      s2 = [];
      s3 = peg$parseStringCharacter();
      while (s3 !== peg$FAILED) {
        s2.push(s3);
        s3 = peg$parseStringCharacter();
      }
      if (s2 !== peg$FAILED) {
        if (input.charCodeAt(peg$currPos) === 34) {
          s3 = peg$c116;
          peg$currPos++;
        } else {
          s3 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c117); }
        }
        if (s3 !== peg$FAILED) {
          peg$savedPos = s0;
          s1 = peg$c118(s2);
          s0 = s1;
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }

    return s0;
  }

  function peg$parseStringCharacter() {
    var s0, s1, s2, s3, s4;

    s0 = peg$currPos;
    if (input.substr(peg$currPos, 2) === peg$c90) {
      s1 = peg$c90;
      peg$currPos += 2;
    } else {
      s1 = peg$FAILED;
      if (peg$silentFails === 0) { peg$fail(peg$c91); }
    }
    if (s1 !== peg$FAILED) {
      peg$savedPos = s0;
      s1 = peg$c92();
    }
    s0 = s1;
    if (s0 === peg$FAILED) {
      s0 = peg$currPos;
      if (input.substr(peg$currPos, 2) === peg$c119) {
        s1 = peg$c119;
        peg$currPos += 2;
      } else {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c120); }
      }
      if (s1 !== peg$FAILED) {
        peg$savedPos = s0;
        s1 = peg$c121();
      }
      s0 = s1;
      if (s0 === peg$FAILED) {
        s0 = peg$currPos;
        if (input.substr(peg$currPos, 2) === peg$c96) {
          s1 = peg$c96;
          peg$currPos += 2;
        } else {
          s1 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c97); }
        }
        if (s1 !== peg$FAILED) {
          peg$savedPos = s0;
          s1 = peg$c98();
        }
        s0 = s1;
        if (s0 === peg$FAILED) {
          s0 = peg$currPos;
          if (input.substr(peg$currPos, 2) === peg$c99) {
            s1 = peg$c99;
            peg$currPos += 2;
          } else {
            s1 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c100); }
          }
          if (s1 !== peg$FAILED) {
            peg$savedPos = s0;
            s1 = peg$c101();
          }
          s0 = s1;
          if (s0 === peg$FAILED) {
            s0 = peg$currPos;
            if (input.substr(peg$currPos, 2) === peg$c102) {
              s1 = peg$c102;
              peg$currPos += 2;
            } else {
              s1 = peg$FAILED;
              if (peg$silentFails === 0) { peg$fail(peg$c103); }
            }
            if (s1 !== peg$FAILED) {
              peg$savedPos = s0;
              s1 = peg$c104();
            }
            s0 = s1;
            if (s0 === peg$FAILED) {
              s0 = peg$currPos;
              if (input.substr(peg$currPos, 2) === peg$c105) {
                s1 = peg$c105;
                peg$currPos += 2;
              } else {
                s1 = peg$FAILED;
                if (peg$silentFails === 0) { peg$fail(peg$c106); }
              }
              if (s1 !== peg$FAILED) {
                peg$savedPos = s0;
                s1 = peg$c107();
              }
              s0 = s1;
              if (s0 === peg$FAILED) {
                s0 = peg$currPos;
                if (input.substr(peg$currPos, 2) === peg$c108) {
                  s1 = peg$c108;
                  peg$currPos += 2;
                } else {
                  s1 = peg$FAILED;
                  if (peg$silentFails === 0) { peg$fail(peg$c109); }
                }
                if (s1 !== peg$FAILED) {
                  s2 = peg$currPos;
                  if (peg$c110.test(input.charAt(peg$currPos))) {
                    s3 = input.charAt(peg$currPos);
                    peg$currPos++;
                  } else {
                    s3 = peg$FAILED;
                    if (peg$silentFails === 0) { peg$fail(peg$c111); }
                  }
                  if (s3 !== peg$FAILED) {
                    if (peg$c110.test(input.charAt(peg$currPos))) {
                      s4 = input.charAt(peg$currPos);
                      peg$currPos++;
                    } else {
                      s4 = peg$FAILED;
                      if (peg$silentFails === 0) { peg$fail(peg$c111); }
                    }
                    if (s4 !== peg$FAILED) {
                      s3 = [s3, s4];
                      s2 = s3;
                    } else {
                      peg$currPos = s2;
                      s2 = peg$FAILED;
                    }
                  } else {
                    peg$currPos = s2;
                    s2 = peg$FAILED;
                  }
                  if (s2 !== peg$FAILED) {
                    peg$savedPos = s0;
                    s1 = peg$c112(s2);
                    s0 = s1;
                  } else {
                    peg$currPos = s0;
                    s0 = peg$FAILED;
                  }
                } else {
                  peg$currPos = s0;
                  s0 = peg$FAILED;
                }
                if (s0 === peg$FAILED) {
                  s0 = peg$currPos;
                  if (peg$c113.test(input.charAt(peg$currPos))) {
                    s1 = input.charAt(peg$currPos);
                    peg$currPos++;
                  } else {
                    s1 = peg$FAILED;
                    if (peg$silentFails === 0) { peg$fail(peg$c114); }
                  }
                  if (s1 !== peg$FAILED) {
                    peg$savedPos = s0;
                    s1 = peg$c115(s1);
                  }
                  s0 = s1;
                }
              }
            }
          }
        }
      }
    }

    return s0;
  }

  function peg$parseWhitespace() {
    var s0, s1, s2;

    peg$silentFails++;
    s0 = peg$currPos;
    s1 = [];
    if (peg$c123.test(input.charAt(peg$currPos))) {
      s2 = input.charAt(peg$currPos);
      peg$currPos++;
    } else {
      s2 = peg$FAILED;
      if (peg$silentFails === 0) { peg$fail(peg$c124); }
    }
    if (s2 !== peg$FAILED) {
      while (s2 !== peg$FAILED) {
        s1.push(s2);
        if (peg$c123.test(input.charAt(peg$currPos))) {
          s2 = input.charAt(peg$currPos);
          peg$currPos++;
        } else {
          s2 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c124); }
        }
      }
    } else {
      s1 = peg$FAILED;
    }
    if (s1 !== peg$FAILED) {
      peg$savedPos = s0;
      s1 = peg$c35();
    }
    s0 = s1;
    peg$silentFails--;
    if (s0 === peg$FAILED) {
      s1 = peg$FAILED;
      if (peg$silentFails === 0) { peg$fail(peg$c122); }
    }

    return s0;
  }

  function peg$parseComment() {
    var s0, s1, s2, s3, s4, s5;

    s0 = peg$currPos;
    if (input.substr(peg$currPos, 2) === peg$c125) {
      s1 = peg$c125;
      peg$currPos += 2;
    } else {
      s1 = peg$FAILED;
      if (peg$silentFails === 0) { peg$fail(peg$c126); }
    }
    if (s1 !== peg$FAILED) {
      s2 = [];
      s3 = peg$currPos;
      s4 = peg$currPos;
      peg$silentFails++;
      if (input.substr(peg$currPos, 2) === peg$c127) {
        s5 = peg$c127;
        peg$currPos += 2;
      } else {
        s5 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c128); }
      }
      peg$silentFails--;
      if (s5 === peg$FAILED) {
        s4 = void 0;
      } else {
        peg$currPos = s4;
        s4 = peg$FAILED;
      }
      if (s4 !== peg$FAILED) {
        if (input.length > peg$currPos) {
          s5 = input.charAt(peg$currPos);
          peg$currPos++;
        } else {
          s5 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c50); }
        }
        if (s5 !== peg$FAILED) {
          s4 = [s4, s5];
          s3 = s4;
        } else {
          peg$currPos = s3;
          s3 = peg$FAILED;
        }
      } else {
        peg$currPos = s3;
        s3 = peg$FAILED;
      }
      while (s3 !== peg$FAILED) {
        s2.push(s3);
        s3 = peg$currPos;
        s4 = peg$currPos;
        peg$silentFails++;
        if (input.substr(peg$currPos, 2) === peg$c127) {
          s5 = peg$c127;
          peg$currPos += 2;
        } else {
          s5 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c128); }
        }
        peg$silentFails--;
        if (s5 === peg$FAILED) {
          s4 = void 0;
        } else {
          peg$currPos = s4;
          s4 = peg$FAILED;
        }
        if (s4 !== peg$FAILED) {
          if (input.length > peg$currPos) {
            s5 = input.charAt(peg$currPos);
            peg$currPos++;
          } else {
            s5 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c50); }
          }
          if (s5 !== peg$FAILED) {
            s4 = [s4, s5];
            s3 = s4;
          } else {
            peg$currPos = s3;
            s3 = peg$FAILED;
          }
        } else {
          peg$currPos = s3;
          s3 = peg$FAILED;
        }
      }
      if (s2 !== peg$FAILED) {
        if (input.substr(peg$currPos, 2) === peg$c127) {
          s3 = peg$c127;
          peg$currPos += 2;
        } else {
          s3 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c128); }
        }
        if (s3 !== peg$FAILED) {
          s1 = [s1, s2, s3];
          s0 = s1;
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }

    return s0;
  }

  function peg$parse_() {
    var s0;

    s0 = peg$parse__();
    if (s0 === peg$FAILED) {
      s0 = null;
    }

    return s0;
  }

  function peg$parse__() {
    var s0, s1;

    s0 = [];
    s1 = peg$parseComment();
    if (s1 === peg$FAILED) {
      s1 = peg$parseWhitespace();
    }
    if (s1 !== peg$FAILED) {
      while (s1 !== peg$FAILED) {
        s0.push(s1);
        s1 = peg$parseComment();
        if (s1 === peg$FAILED) {
          s1 = peg$parseWhitespace();
        }
      }
    } else {
      s0 = peg$FAILED;
    }

    return s0;
  }

  function peg$parseConditionalKeyword() {
    var s0;

    if (input.substr(peg$currPos, 2) === peg$c129) {
      s0 = peg$c129;
      peg$currPos += 2;
    } else {
      s0 = peg$FAILED;
      if (peg$silentFails === 0) { peg$fail(peg$c130); }
    }
    if (s0 === peg$FAILED) {
      if (input.substr(peg$currPos, 6) === peg$c131) {
        s0 = peg$c131;
        peg$currPos += 6;
      } else {
        s0 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c132); }
      }
    }

    return s0;
  }

  function peg$parseLoopingKeyword() {
    var s0;

    if (input.substr(peg$currPos, 5) === peg$c133) {
      s0 = peg$c133;
      peg$currPos += 5;
    } else {
      s0 = peg$FAILED;
      if (peg$silentFails === 0) { peg$fail(peg$c134); }
    }
    if (s0 === peg$FAILED) {
      if (input.substr(peg$currPos, 5) === peg$c135) {
        s0 = peg$c135;
        peg$currPos += 5;
      } else {
        s0 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c136); }
      }
    }

    return s0;
  }

  function peg$parseUnaryToken() {
    var s0;

    if (input.charCodeAt(peg$currPos) === 43) {
      s0 = peg$c137;
      peg$currPos++;
    } else {
      s0 = peg$FAILED;
      if (peg$silentFails === 0) { peg$fail(peg$c138); }
    }
    if (s0 === peg$FAILED) {
      if (input.charCodeAt(peg$currPos) === 45) {
        s0 = peg$c139;
        peg$currPos++;
      } else {
        s0 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c140); }
      }
      if (s0 === peg$FAILED) {
        if (input.charCodeAt(peg$currPos) === 126) {
          s0 = peg$c141;
          peg$currPos++;
        } else {
          s0 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c142); }
        }
        if (s0 === peg$FAILED) {
          if (input.substr(peg$currPos, 3) === peg$c143) {
            s0 = peg$c143;
            peg$currPos += 3;
          } else {
            s0 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c144); }
          }
        }
      }
    }

    return s0;
  }

  function peg$parseBinaryToken() {
    var s0;

    if (input.charCodeAt(peg$currPos) === 42) {
      s0 = peg$c55;
      peg$currPos++;
    } else {
      s0 = peg$FAILED;
      if (peg$silentFails === 0) { peg$fail(peg$c56); }
    }
    if (s0 === peg$FAILED) {
      if (input.charCodeAt(peg$currPos) === 47) {
        s0 = peg$c145;
        peg$currPos++;
      } else {
        s0 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c146); }
      }
      if (s0 === peg$FAILED) {
        if (input.substr(peg$currPos, 3) === peg$c147) {
          s0 = peg$c147;
          peg$currPos += 3;
        } else {
          s0 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c148); }
        }
        if (s0 === peg$FAILED) {
          if (input.charCodeAt(peg$currPos) === 43) {
            s0 = peg$c137;
            peg$currPos++;
          } else {
            s0 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c138); }
          }
          if (s0 === peg$FAILED) {
            if (input.charCodeAt(peg$currPos) === 45) {
              s0 = peg$c139;
              peg$currPos++;
            } else {
              s0 = peg$FAILED;
              if (peg$silentFails === 0) { peg$fail(peg$c140); }
            }
            if (s0 === peg$FAILED) {
              if (input.charCodeAt(peg$currPos) === 124) {
                s0 = peg$c149;
                peg$currPos++;
              } else {
                s0 = peg$FAILED;
                if (peg$silentFails === 0) { peg$fail(peg$c150); }
              }
              if (s0 === peg$FAILED) {
                if (input.charCodeAt(peg$currPos) === 38) {
                  s0 = peg$c151;
                  peg$currPos++;
                } else {
                  s0 = peg$FAILED;
                  if (peg$silentFails === 0) { peg$fail(peg$c152); }
                }
                if (s0 === peg$FAILED) {
                  if (input.charCodeAt(peg$currPos) === 94) {
                    s0 = peg$c153;
                    peg$currPos++;
                  } else {
                    s0 = peg$FAILED;
                    if (peg$silentFails === 0) { peg$fail(peg$c154); }
                  }
                  if (s0 === peg$FAILED) {
                    if (input.substr(peg$currPos, 3) === peg$c155) {
                      s0 = peg$c155;
                      peg$currPos += 3;
                    } else {
                      s0 = peg$FAILED;
                      if (peg$silentFails === 0) { peg$fail(peg$c156); }
                    }
                    if (s0 === peg$FAILED) {
                      if (input.substr(peg$currPos, 3) === peg$c157) {
                        s0 = peg$c157;
                        peg$currPos += 3;
                      } else {
                        s0 = peg$FAILED;
                        if (peg$silentFails === 0) { peg$fail(peg$c158); }
                      }
                      if (s0 === peg$FAILED) {
                        if (input.substr(peg$currPos, 2) === peg$c159) {
                          s0 = peg$c159;
                          peg$currPos += 2;
                        } else {
                          s0 = peg$FAILED;
                          if (peg$silentFails === 0) { peg$fail(peg$c160); }
                        }
                        if (s0 === peg$FAILED) {
                          if (input.substr(peg$currPos, 2) === peg$c161) {
                            s0 = peg$c161;
                            peg$currPos += 2;
                          } else {
                            s0 = peg$FAILED;
                            if (peg$silentFails === 0) { peg$fail(peg$c162); }
                          }
                          if (s0 === peg$FAILED) {
                            if (input.substr(peg$currPos, 2) === peg$c163) {
                              s0 = peg$c163;
                              peg$currPos += 2;
                            } else {
                              s0 = peg$FAILED;
                              if (peg$silentFails === 0) { peg$fail(peg$c164); }
                            }
                            if (s0 === peg$FAILED) {
                              if (input.substr(peg$currPos, 2) === peg$c165) {
                                s0 = peg$c165;
                                peg$currPos += 2;
                              } else {
                                s0 = peg$FAILED;
                                if (peg$silentFails === 0) { peg$fail(peg$c166); }
                              }
                              if (s0 === peg$FAILED) {
                                if (input.charCodeAt(peg$currPos) === 60) {
                                  s0 = peg$c167;
                                  peg$currPos++;
                                } else {
                                  s0 = peg$FAILED;
                                  if (peg$silentFails === 0) { peg$fail(peg$c168); }
                                }
                                if (s0 === peg$FAILED) {
                                  if (input.charCodeAt(peg$currPos) === 62) {
                                    s0 = peg$c169;
                                    peg$currPos++;
                                  } else {
                                    s0 = peg$FAILED;
                                    if (peg$silentFails === 0) { peg$fail(peg$c170); }
                                  }
                                  if (s0 === peg$FAILED) {
                                    if (input.substr(peg$currPos, 3) === peg$c171) {
                                      s0 = peg$c171;
                                      peg$currPos += 3;
                                    } else {
                                      s0 = peg$FAILED;
                                      if (peg$silentFails === 0) { peg$fail(peg$c172); }
                                    }
                                    if (s0 === peg$FAILED) {
                                      if (input.substr(peg$currPos, 2) === peg$c173) {
                                        s0 = peg$c173;
                                        peg$currPos += 2;
                                      } else {
                                        s0 = peg$FAILED;
                                        if (peg$silentFails === 0) { peg$fail(peg$c174); }
                                      }
                                      if (s0 === peg$FAILED) {
                                        if (input.charCodeAt(peg$currPos) === 61) {
                                          s0 = peg$c32;
                                          peg$currPos++;
                                        } else {
                                          s0 = peg$FAILED;
                                          if (peg$silentFails === 0) { peg$fail(peg$c33); }
                                        }
                                      }
                                    }
                                  }
                                }
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }

    return s0;
  }

  function peg$parseDigits() {
    var s0, s1, s2;

    s0 = peg$currPos;
    s1 = [];
    if (peg$c175.test(input.charAt(peg$currPos))) {
      s2 = input.charAt(peg$currPos);
      peg$currPos++;
    } else {
      s2 = peg$FAILED;
      if (peg$silentFails === 0) { peg$fail(peg$c176); }
    }
    if (s2 !== peg$FAILED) {
      while (s2 !== peg$FAILED) {
        s1.push(s2);
        if (peg$c175.test(input.charAt(peg$currPos))) {
          s2 = input.charAt(peg$currPos);
          peg$currPos++;
        } else {
          s2 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c176); }
        }
      }
    } else {
      s1 = peg$FAILED;
    }
    if (s1 !== peg$FAILED) {
      peg$savedPos = s0;
      s1 = peg$c177(s1);
    }
    s0 = s1;

    return s0;
  }

  function peg$parseHexadecimalDigits() {
    var s0, s1, s2;

    s0 = peg$currPos;
    s1 = [];
    if (peg$c178.test(input.charAt(peg$currPos))) {
      s2 = input.charAt(peg$currPos);
      peg$currPos++;
    } else {
      s2 = peg$FAILED;
      if (peg$silentFails === 0) { peg$fail(peg$c179); }
    }
    if (s2 !== peg$FAILED) {
      while (s2 !== peg$FAILED) {
        s1.push(s2);
        if (peg$c178.test(input.charAt(peg$currPos))) {
          s2 = input.charAt(peg$currPos);
          peg$currPos++;
        } else {
          s2 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c179); }
        }
      }
    } else {
      s1 = peg$FAILED;
    }
    if (s1 !== peg$FAILED) {
      peg$savedPos = s0;
      s1 = peg$c177(s1);
    }
    s0 = s1;

    return s0;
  }

  function peg$parseBinaryDigits() {
    var s0, s1, s2;

    s0 = peg$currPos;
    s1 = [];
    if (peg$c180.test(input.charAt(peg$currPos))) {
      s2 = input.charAt(peg$currPos);
      peg$currPos++;
    } else {
      s2 = peg$FAILED;
      if (peg$silentFails === 0) { peg$fail(peg$c181); }
    }
    if (s2 !== peg$FAILED) {
      while (s2 !== peg$FAILED) {
        s1.push(s2);
        if (peg$c180.test(input.charAt(peg$currPos))) {
          s2 = input.charAt(peg$currPos);
          peg$currPos++;
        } else {
          s2 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c181); }
        }
      }
    } else {
      s1 = peg$FAILED;
    }
    if (s1 !== peg$FAILED) {
      peg$savedPos = s0;
      s1 = peg$c177(s1);
    }
    s0 = s1;

    return s0;
  }


      function makeNode(node) {
          return new Proxy(node, {
              get(target, prop) {
                  // special case for util.inspect() and console.log() to work
                  if (prop === 'inspect') {
                      return undefined;
                  }

                  if (typeof prop !== 'symbol' && !(prop in target)) {
                      throw new Error(`${target.kind} has no property named ${prop}`);
                  }

                  return target[prop];
              },

              set(target, prop, value) {
                  throw new Error('cannot change node properties');
              },

              has(target, prop) {
                  return prop in target;
              },
          });
      }

      const tree = new Proxy({}, {
          get(target, kind, receiver) {
              return (extra = {}) => {
                  return makeNode(Object.assign({
                      kind,
                      location: location(),
                  }, extra));
              };
          },
      });

      const left = Symbol('left');
      const right = Symbol('right');

      const reservedWords = [
          'if', 'unless', 'fn', 'not', 'and', 'or', 'while', 'until', 'return',
          'var', 'const', 'asm',
      ];

      const emptyBody = tree.Body({ statements: [] });

      const binaryOperators = {
          '*': { associativity: left, precedence: 60 },
          '/': { associativity: left, precedence: 60 },
          'mod': { associativity: left, precedence: 60 },

          '+': { associativity: left, precedence: 50 },
          '-': { associativity: left, precedence: 50 },
          '|': { associativity: left, precedence: 50 },
          '&': { associativity: left, precedence: 50 },

          'shl': { associativity: left, precedence: 40 },
          'shr': { associativity: left, precedence: 40 },

          '==': { associativity: left, precedence: 30 },
          '!=': { associativity: left, precedence: 30 },
          '<':    { associativity: left, precedence: 30 },
          '>':    { associativity: left, precedence: 30 },
          '<=': { associativity: left, precedence: 30 },
          '>=': { associativity: left, precedence: 30 },

          'and': { associativity: left, precedence: 20 },
          'or': { associativity: left, precedence: 10 },

          '=': { associativity: right, precedence: 0 },
      };

      function isLeftAssociative(operator) {
          return binaryOperators[operator].associativity === left;
      }

      function isRightAssociative(operator) {
          return binaryOperators[operator].associativity === right;
      }

      function precedenceOf(operator) {
          return binaryOperators[operator].precedence;
      }

      function nth(index, array = null) {
          return (element) => element[index];
      }

      function get(array, index, defaultValue = null) {
          if (Array.isArray(array) && array[index] !== undefined) {
              return array[index];
          }

          return defaultValue;
      }

      function value(v) {
          return () => v;
      }

      function checkNotReserved(word) {
          if (reservedWords.includes(word)) {
              throwSyntaxError(`unexpected reserved word ${word}`);
          }
      }

      function throwSyntaxError(message) {
          const error = new Error(message);
          error.location = location();
          error.name = "SyntaxError";

          throw error;
      }

      function toString(characters) {
          if (typeof characters === 'string') {
              return characters;
          }
          if (!Array.isArray(characters)) {
              throw new TypeError(`toString() accepts string or array of strings.`);
          }

          return characters
              .map(toString)
              .join('');
      }

      function toInteger(s, base) {
          // TODO: line numbers in manual errors
          s = toString(s);
          if (s[0] === '_' || s[s.length - 1] === '_') {
              throwSyntaxError('Thousand separators allowed only inside numerals.');
          }

          return parseInt(s.replace(/_/g, ''), base);
      }

      function notEmpty(value) {
          return value !== undefined;
      }

      // (
      //     head: PrimaryExpression,
      //     tail: [unknown, BinaryToken, unknown, PrimaryExpresion][]
      // ) => PrimaryExpression | BinaryOperator
      function operatorsToTree({ head, tail }) {
          // { operator: BinaryToken, rhs: PrimaryExpression }[]
          tail = tail.map((element) => {
              return {
                  operator: element[1],
                  rhs: element[3],
              };
          });

          // (lhs: Expression, minPrecedence: number) => Expression
          function collect(lhs, minPrecedence) {
              let operator, rhs;

              while (tail.length && precedenceOf(tail[0].operator) >= minPrecedence) {
                  const tmp = tail.shift();
                  operator = tmp.operator;
                  // PrimaryExpression
                  rhs = tmp.rhs;

                  let lookahead = tail[0];
                  while (
                      tail.length &&
                      (precedenceOf(lookahead.operator) > precedenceOf(operator) ||
                       isRightAssociative(lookahead.operator) &&
                       precedenceOf(lookahead.operator) === precedenceOf(operator))
                  ) {
                      rhs = collect(rhs, precedenceOf(lookahead.operator));
                      lookahead = tail[0];
                  }

                  lhs = tree.BinaryOperator({
                      lhs,
                      operator,
                      rhs,
                  });
              }

              return lhs;
          }

          return collect(head, 0);
      }


  peg$result = peg$startRuleFunction();

  if (peg$result !== peg$FAILED && peg$currPos === input.length) {
    return peg$result;
  } else {
    if (peg$result !== peg$FAILED && peg$currPos < input.length) {
      peg$fail(peg$endExpectation());
    }

    throw peg$buildStructuredError(
      peg$maxFailExpected,
      peg$maxFailPos < input.length ? input.charAt(peg$maxFailPos) : null,
      peg$maxFailPos < input.length
        ? peg$computeLocation(peg$maxFailPos, peg$maxFailPos + 1)
        : peg$computeLocation(peg$maxFailPos, peg$maxFailPos)
    );
  }
}

module.exports = {
  SyntaxError: peg$SyntaxError,
  parse:       peg$parse
};

},{}],7:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseFile = exports.parse = void 0;
const { readFile, writeFile, showCompileError, isOutOfDate, } = require('./utils');
exports.parse = require('./parse-generated').parse;
function parseFile(filename) {
    return (0, exports.parse)(readFile(filename), {
        tracer: {
            trace(e) {
                // noop
            },
        }
    });
}
exports.parseFile = parseFile;

},{"./parse-generated":6,"./utils":11}],8:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RegisterAllocator = exports.registers = void 0;
const assembly_1 = require("./assembly");
require("./utils");
exports.registers = {
    ax: new assembly_1.Register('AX'),
    bx: new assembly_1.Register('BX'),
    cx: new assembly_1.Register('CX'),
    dx: new assembly_1.Register('DX'),
    bp: new assembly_1.Register('BP'),
};
class RegisterAllocator {
    constructor(assemblyWriter) {
        this.assemblyWriter = assemblyWriter;
        /**
         * List of all general-purpose registers that can be used to compute expressions.
         */
        this.all = [exports.registers.ax, exports.registers.bx, exports.registers.dx];
        /**
         * Index of the next unallocated register in the above array.  If this is equal to the number of all registers,
         * then no register is available and we must save on the stack.
         */
        this.nextUnallocated = 0;
        this.firstInaccessible = this.all.length;
        /**
         * Maximum number of registers that may be used at the same time.
         */
        this.maxUsed = this.all.length;
    }
    /**
     * Borrows the register.  This function guarantees that the data in the requested register value will not be lost
     * if the register is already allocated (i.e. used for other computations).  This is useful for instructions such
     * as CCF (copy carry flag), which always write to a particular register.
     */
    borrowRegister(register, fn) {
        trace('register-borrowing', 'ignore', register.name);
        // If the register is not used for anything else, do not save the value.
        if (!this.isAllocated(register)) {
            return fn();
        }
        trace('register-borrowing', 'start', register.name);
        // Otherwise, save on the stack.
        this.assemblyWriter.opcode('push', register);
        const result = fn();
        this.assemblyWriter.opcode('pop', register);
        trace('register-borrowing', 'end', register.name);
        return result;
    }
    isAllocated(register) {
        const index = this.all.findIndex(r => r.isEqualTo(register));
        return this.nextUnallocated > index;
    }
    callWithFreeRegister(fn) {
        if (this.nextUnallocated < this.firstInaccessible) {
            const register = this.all[this.nextUnallocated];
            // If a register is available, use it.
            trace('register-allocation', 'start', register.name);
            this.nextUnallocated++;
            const result = fn(register);
            trace('register-allocation', 'end', register.name);
            this.nextUnallocated--;
            return result;
        }
        // Otherwise wrap around, saving the previous value on the stack.
        const register = this.all[this.nextUnallocated % this.maxUsed];
        trace('register-allocation', 'start', register.name);
        this.assemblyWriter.opcode('pop', register);
        this.nextUnallocated++;
        const result = fn(register);
        trace('register-allocation', 'end', register.name);
        this.assemblyWriter.opcode('pop', register);
        this.nextUnallocated--;
        return result;
    }
}
exports.RegisterAllocator = RegisterAllocator;

},{"./assembly":2,"./utils":11}],9:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Scope = void 0;
class Scope {
    constructor(parent = null, bindings = {}) {
        this.parent = parent;
        this.bindings = bindings;
    }
    lookup(name, error) {
        if (this.bindings.hasOwnProperty(name)) {
            return this.bindings[name];
        }
        if (this.parent !== null) {
            return this.parent.lookup(name, error);
        }
        error(name);
    }
    bind(name, binding, alreadyBound) {
        if (this.bindings.hasOwnProperty(name)) {
            alreadyBound(this.bindings[name]);
        }
        this.bindings[name] = binding;
    }
    extend(newBindings = {}) {
        return new Scope(this, newBindings);
    }
}
exports.Scope = Scope;
exports.Scope = Scope;

},{}],10:[function(require,module,exports){
exports.setup = function setup(enabledTraces) {
    global.tracing = {};
    global.tracing.enabledTraces = enabledTraces;
    global.tracing.traceHandlers = [(family, ...args) => {
        console.log(`trace(${family}):`, ...args);
    }];

    global.tracing.setTraceHandler = handler => {
        global.tracing.traceHandlers.unshift(handler);
    };

    global.tracing.restoreTraceHandler = () => {
        if (global.tracing.traceHandlers.length > 1) {
            global.tracing.traceHandlers.shift();
        }
    };

    global.trace = (family, ...args) => {
        if (enabledTraces.includes('all') || enabledTraces.includes(family)) {
            global.tracing.traceHandlers[0](family, ...args);
        }
    };
};

},{}],11:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.writeFile = exports.readFile = exports.nodesEqual = exports.isNode = exports.isIndexableObject = exports.isProperObject = exports.traceParseTree = exports.bug = exports.showCompileError = exports.isCompileError = exports.showLocation = exports.isOutOfDate = exports.generateUniqueId = exports.lastModified = exports.inspect = exports.CompileError = void 0;
const fs = require("fs");
const util = require("util");
class CompileError extends Error {
    constructor(message, location, filename = null) {
        super(message);
        this.location = location;
        this.filename = filename;
    }
}
exports.CompileError = CompileError;
function inspect(value) {
    console.log(util.inspect(value, {
        showHidden: false,
        depth: null,
        colors: process.stdout.isTTY,
        breakLength: 20,
    }));
}
exports.inspect = inspect;
function lastModified(filename) {
    return fs.statSync(filename).mtime;
}
exports.lastModified = lastModified;
function generateUniqueId() {
    return (((1 + Math.random()) * 4294967296) | 0).toString(16).substring(1).padStart(8, '0');
}
exports.generateUniqueId = generateUniqueId;
function isOutOfDate(prerequisiteFilename, targetFilename) {
    try {
        return lastModified(prerequisiteFilename) > lastModified(targetFilename);
    }
    catch (error) {
        return true;
    }
}
exports.isOutOfDate = isOutOfDate;
function showLocation(location) {
    if (!isProperObject(location)) {
        return '??';
    }
    if (location.start.line === location.end.line) {
        return `${location.start.line}:${location.start.column}`;
    }
    return `${location.start.line}:${location.start.column}-${location.end.line}:${location.end.column}`;
}
exports.showLocation = showLocation;
function isCompileError(error) {
    return error instanceof Error && (error.name === 'SyntaxError'
        || error.constructor.name === 'SyntaxError'
        || error.constructor.name === 'CompileError');
}
exports.isCompileError = isCompileError;
function showCompileError(error) {
    console.error(`${error.filename || 'stdin'}:${showLocation(error.location)}: ${error}`);
}
exports.showCompileError = showCompileError;
function bug(message) {
    console.error(`fatal: You have encountered a compiler bug.`);
    throw new Error(`fatal: ${message}`);
}
exports.bug = bug;
function traceParseTree(nodes, level = 0, { indentFirstLine = true, } = {}) {
    const isInterestingProperty = (prop) => prop !== 'kind' && prop !== 'location' && prop !== 'toString';
    if (!Array.isArray(nodes)) {
        nodes = [nodes];
    }
    nodes.forEach((node) => {
        let indent = new Array(level + 1).join('  ');
        console.log((indentFirstLine ? indent : '') + node.kind, showLocation(node.location));
        indent += '  ';
        Object.keys(node).filter(isInterestingProperty).forEach(key => {
            const property = node[key];
            process.stdout.write(indent);
            if (isNode(property)) {
                process.stdout.write(`${key}: `);
                traceParseTree(property, level + 1, { indentFirstLine: false });
            }
            else if (Array.isArray(property)) {
                process.stdout.write(`${key}:\n`);
                traceParseTree(property, level + 2);
            }
            else {
                console.log(`${key}: ${property}`);
            }
        });
    });
}
exports.traceParseTree = traceParseTree;
function isProperObject(value) {
    return typeof value === 'object' && value !== null;
}
exports.isProperObject = isProperObject;
// This a separate function purely for typing purposes.
function isIndexableObject(value) {
    return typeof value === 'object' && value !== null;
}
exports.isIndexableObject = isIndexableObject;
function isNode(object) {
    return isIndexableObject(object) && object.hasOwnProperty('kind') && typeof object.kind === 'string';
}
exports.isNode = isNode;
function nodesEqual(left, right) {
    const performDeepComparison = isIndexableObject(left) && isIndexableObject(right);
    if (performDeepComparison) {
        if ('isEqualTo' in left && typeof left.isEqualTo === 'function') {
            const result = left.isEqualTo(right);
            if (typeof result === 'boolean') {
                return result;
            }
            // If isEqualTo() didn't return a boolean, it means it does not support the comparison.
        }
        return Object.keys(left)
            .filter(key => key !== 'location')
            .filter(key => key in right)
            .every(key => nodesEqual(left[key], right[key]));
    }
    return left === right;
}
exports.nodesEqual = nodesEqual;
function readFile(filename) {
    return fs.readFileSync(filename, 'utf-8');
}
exports.readFile = readFile;
function writeFile(filename, content) {
    fs.writeFileSync(filename, content, { encoding: 'utf-8' });
}
exports.writeFile = writeFile;

},{"fs":undefined,"util":undefined}]},{},[4]);
