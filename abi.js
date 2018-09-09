const { Register, Relative, Immediate } = require('./assembly.js');
const { CompileError } = require('./utility.js');

function getReservationSize(type) {
    switch (type.kind) {
    case 'NamedType':
    case 'PointerType':
        return 1;

    case 'ArrayType':
        return type.capacity.value * getReservationSize(type.type);

    default:
        throw new Error(`Unknown type kind: ${type.kind}.`);
    }
}

class StdcallConvention {
    validateDeclaration(declaration) {
    }

    emitCall(binding, args, state) {
        for (let argument of args) {
            state.callWithFreeRegister(register => {
                state.computeExpressionIntoRegister(register, argument, state);
                state.assemblyWriter.push(register);
            });
        }

        state.assemblyWriter.opcode('call', new Relative(binding.label));

        trace('caller-cleanup', 'start');
        state.callWithFreeRegister(register => {
            state.assemblyWriter.pop(register);
        });
        trace('caller-cleanup', 'end');
    }

    emitPrologue(binding, parameterBindings, state) {
        if (binding.parameters.length) {
            let shift = 0;
            binding.parameters.forEach(parameter => {
                shift++;
                state.assemblyWriter.opcode('add', new Register('sp'), new Immediate(1));
                state.assemblyWriter.mov(parameterBindings[parameter.name].label, new Relative(new Register('sp')));
            });
            state.assemblyWriter.opcode('sub', new Register('sp'), new Immediate(shift));
        }
    }

    emitEpilogue(binding, parameterBindings, state) {
    }
}

class FastcallConvention {
    constructor() {
        this.registers = [new Register('ax'), new Register('bx'), new Register('cx'), new Register('dx')];
    }

    validateDeclaration(declaration, state) {
        if (declaration.parameters.length > this.registers.length) {
            throw state.createError(`Fastcall convention supports at most ${this.registers.length} parameters.`);
        }
    }

    emitCall(binding, args, state) {
        trace('fastcall', 'save');
        this.registers.forEach(r => state.assemblyWriter.opcode('push', r));
        trace('fastcall', 'saved');

        for (let i = 0; i < args.length; i++) {
            state.computeExpressionIntoRegister(this.registers[i], args[i], state);
        }

        state.assemblyWriter.opcode('call', new Relative(binding.label));

        trace('fastcall', 'restore');
        this.registers.reverse().forEach(r => state.assemblyWriter.opcode('pop', r));
        trace('fastcall', 'end');
    }

    emitPrologue(binding, parameterBindings, state) {
        if (binding.parameters.length) {
            binding.parameters.forEach((parameter, i) => {
                state.assemblyWriter.mov(parameterBindings[parameter.name].label, this.registers[i]);
            });
        }
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

exports.getReservationSize = getReservationSize;
exports.createCallingConvention = createCallingConvention;
