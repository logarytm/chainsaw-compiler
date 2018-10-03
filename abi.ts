import { Register, Relative } from './assembly';
import './utils';

export function getReservationSize(type) {
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

interface ICallingConvention {
    validateDeclaration(binding, state);

    emitCall(binding, args, state);

    emitPrologue(binding, args, state);

    emitEpilogue(binding, args, state);
}

class StdcallConvention implements ICallingConvention {
    validateDeclaration(binding, state) {
    }

    emitCall(binding, args, state) {
        for (let argument of args) {
            state.callWithFreeRegister(register => {
                state.computeExpressionIntoRegister(register, argument, state);
                state.assemblyWriter.opcode('push', register);
            });
        }

        state.assemblyWriter.opcode('call', new Relative(binding.label));

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

class FastcallConvention implements ICallingConvention {
    private registers: Register[];

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
                state.assemblyWriter.opcode('mov', parameterBindings[parameter.name].label, this.registers[i]);
            });
        }
    }

    emitEpilogue(binding, parameterBindings, state) {
    }
}

export function createCallingConvention(name) {
    switch (name) {
    case 'stdcall':
        return new StdcallConvention();

    case 'fastcall':
        return new FastcallConvention();

    default:
        throw new Error(`Unimplemented calling convention: ${name}.`);
    }
}
