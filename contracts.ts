import { Scope } from './scope';
import { AssemblyWriter, Register } from './assembly';
import { CompileError } from './utils';
import { RegisterAllocator } from './register';

export type CodegenState = {
    scope: Scope;
    prefix: string;
    assemblyWriter: AssemblyWriter;
    extend(object: Partial<CodegenState>): CodegenState;
    createError(message: string): CompileError;
    registerAllocator: RegisterAllocator;
    callWithFreeRegister<T>(fn: (register: Register) => T): T;
    callWithFreeRegisters<T>(count, fn: (...registers: Register[]) => T, registers?: Register[]): T;
    borrowRegister<T>(register: Register, fn: () => T): T;
};
