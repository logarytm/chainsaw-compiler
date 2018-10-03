import { AssemblyWriter, Register } from './assembly';
import './utils';

export const registers = {
    ax: new Register('AX'),
    bx: new Register('BX'),
    cx: new Register('CX'),
    dx: new Register('DX'),
    bp: new Register('BP'),
};

export class RegisterAllocator {
    private assemblyWriter: AssemblyWriter;
    private nextUnallocated: number;
    private firstInaccessible: number;
    private maxUsed: number;
    private all: Register[];

    constructor(assemblyWriter) {
        this.assemblyWriter = assemblyWriter;

        /**
         * List of all general-purpose registers that can be used to compute expressions.
         */
        this.all = [registers.ax, registers.bx, registers.dx];

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
