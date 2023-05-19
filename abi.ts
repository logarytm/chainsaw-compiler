import { Register, Relative } from './assembly';
import './utils';
import { Binding, CodegenState, FunctionBinding, ParameterBinding } from './contracts';
import { Expression, Type } from './grammar';

export function getReservationSize(type: Type): number {
    switch (type.kind) {
    case 'NamedType':
    case 'PointerType':
        return 1;

    case 'ArrayType':
        return type.capacity.value * getReservationSize(type.type);
    }
}

export type ParameterBindings = { [name: string]: ParameterBinding };

export interface ICallingConvention {
    assertDeclarationIsValid(binding: FunctionBinding, state: CodegenState): void;

    emitCall(
        binding: FunctionBinding,
        args: Expression[],
        state: CodegenState,
        computeExpressionIntoRegister: (register: Register, argument: any, state: CodegenState) => void,
    ): void;

    emitPrologue(binding: FunctionBinding, parameterBindings: ParameterBindings, state: CodegenState): void;

    emitEpilogue(binding: FunctionBinding, parameterBindings: ParameterBindings, state: CodegenState): void;
}

class StdcallConvention implements ICallingConvention {
    public assertDeclarationIsValid(binding: Binding, state: CodegenState): void {
    }

    public emitCall(
        binding: FunctionBinding,
        args: Expression[],
        state: CodegenState,
        computeExpressionIntoRegister: (register: Register, argument: any, state: CodegenState) => void,
    ): void {
        for (let argument of args) {
            state.callWithFreeRegister(register => {
                computeExpressionIntoRegister(register, argument, state);
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

    public emitPrologue(binding: FunctionBinding, parameterBindings: ParameterBindings, state: CodegenState): void {
    }

    public emitEpilogue(binding: FunctionBinding, parameterBindings: ParameterBindings, state: CodegenState): void {
    }
}

class FastcallConvention implements ICallingConvention {
    private readonly registers: Register[];

    public constructor() {
        this.registers = [new Register('ax'), new Register('bx'), new Register('cx'), new Register('dx')];
    }

    public assertDeclarationIsValid(declaration: FunctionBinding, state: CodegenState): void {
        if (declaration.parameters.length > this.registers.length) {
            throw state.createError(`Fastcall convention supports at most ${this.registers.length} parameters.`);
        }
    }

    public emitCall(
        binding: FunctionBinding,
        args: Expression[],
        state: CodegenState,
        computeExpressionIntoRegister: (register: Register, argument: any, state: CodegenState) => void,
    ): void {
        trace('fastcall', 'save');
        this.registers.forEach(r => state.assemblyWriter.opcode('push', r));
        trace('fastcall', 'saved');

        for (let i = 0; i < args.length; i++) {
            computeExpressionIntoRegister(this.registers[i], args[i], state);
        }

        state.assemblyWriter.opcode('call', new Relative(binding.label));

        trace('fastcall', 'restore');
        this.registers.reverse().forEach(r => state.assemblyWriter.opcode('pop', r));
        trace('fastcall', 'end');
    }

    public emitPrologue(binding: FunctionBinding, parameterBindings: ParameterBindings, state: CodegenState): void {
        if (binding.parameters.length) {
            binding.parameters.forEach((parameter, i) => {
                state.assemblyWriter.opcode('mov', parameterBindings[parameter.name].label, this.registers[i]);
            });
        }
    }

    public emitEpilogue(binding: FunctionBinding, parameterBindings: ParameterBindings, state: CodegenState): void {
    }
}

export function createCallingConvention(name: string): ICallingConvention {
    switch (name) {
    case 'stdcall':
        return new StdcallConvention();

    case 'fastcall':
        return new FastcallConvention();

    default:
        throw new Error(`Unimplemented calling convention: ${name}.`);
    }
}
