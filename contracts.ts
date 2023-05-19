import { Scope } from './scope';
import { AssemblyWriter, Label, Register } from './assembly';
import { CompileError } from './utils';
import { RegisterAllocator } from './register';
import { AnyNode } from './grammar';
import { ICallingConvention } from './abi';

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

/**
 * These values are assigned to names in the scope.  For example, every function declaration has FUNCTION_NATURE, and
 * we can protect from assigning to functions by checking the nature property of a name.
 */
export const FUNCTION_NATURE = Symbol('function');
export const VARIABLE_NATURE = Symbol('variable');
export const PARAMETER_NATURE = Symbol('parameter');

export type BindingNature = typeof FUNCTION_NATURE | typeof VARIABLE_NATURE | typeof PARAMETER_NATURE;

export type FunctionBinding = {
    label: Label;
    functionName: string;
    isDefinition: boolean;
    arity: number;
    parameters;
    returnType: AnyNode;
    hasReturnValue: boolean;
    callingConvention: ICallingConvention;
    nature: typeof FUNCTION_NATURE;
};

export type VariableBinding = {
    label: Label;
    name: string;
    type: AnyNode;
    nature: typeof VARIABLE_NATURE;
};

export type ParameterBinding = {
    label: Label;
    name: string;
    type: AnyNode;
    nature: typeof PARAMETER_NATURE;
};

export type Binding = FunctionBinding | VariableBinding | ParameterBinding;
