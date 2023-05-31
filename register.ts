import { AssemblyWriter, Register } from './assembly';

export const registers = {
    ax: new Register('AX'),
    bx: new Register('BX'),
    cx: new Register('CX'),
    dx: new Register('DX'),
    bp: new Register('BP'),
};

export class RegisterAllocator {
    private assemblyWriter: AssemblyWriter;
    private readonly allocated: Set<Register>;
    private wraparound: number;
    public readonly maxUsed: number;
    private readonly all: Register[];

    constructor(assemblyWriter: AssemblyWriter) {
        this.assemblyWriter = assemblyWriter;

        /**
         * List of all general-purpose registers that can be used to compute expressions.
         */
        this.all = [registers.ax, registers.bx, registers.dx];

        /**
         * Index of the next unallocated register in the above array.  If this is equal to the number of all registers,
         * then no register is available and we must save on the stack.
         */
        this.allocated = new Set<Register>();

        this.wraparound = 0;

        /**
         * Maximum number of registers that may be used at the same time.
         */
        this.maxUsed = this.all.length;
    }

    markRegisterAsUsed<T>(register: Register, fn: () => T) {
        if (this.allocated.has(register)) {
            throw new Error('Cannot mark register as used. This is a compiler bug.');
        }

        this.allocated.add(register);
        const result = fn();
        this.allocated.delete(register);

        return result;
    }

    /**
     * Borrows the register.  This function guarantees that the data in the requested register value will not be lost
     * if the register is already allocated (i.e. used for other computations).  This is useful for instructions such
     * as CCF (copy carry flag), which always write to a particular register.
     */
    borrowRegister<T>(register: Register, fn: () => T) {
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

    isAllocated(register: Register): boolean {
        return this.allocated.has(register);
    }

    private haveFreeRegisters(): boolean {
        return this.allocated.size < this.all.length;
    }

    callWithFreeRegister<T>(fn: (register: Register) => T) {
        if (this.haveFreeRegisters()) {
            const register = this.all.find(register => !this.allocated.has(register)) as Register;

            // If a register is available, use it.
            trace('register-allocation', 'start', register.name);
            this.allocated.add(register);

            const result = fn(register);

            trace('register-allocation', 'end', register.name);
            this.allocated.delete(register);

            return result;
        }

        // Otherwise wrap around, saving the previous value on the stack.
        this.wraparound = (this.wraparound + 1) % this.all.length;
        const register = this.all[this.wraparound];

        trace('register-allocation', 'start', register.name);
        this.assemblyWriter.opcode('pop', register);

        const result = fn(register);

        trace('register-allocation', 'end', register.name);
        this.assemblyWriter.opcode('pop', register);

        return result;
    }
}
