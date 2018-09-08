const { Register } = require('./assembly.js');

const registers = {
    ax: new Register('AX'),
    bx: new Register('BX'),
    cx: new Register('CX'),
    dx: new Register('DX'),
};

class RegisterAllocator {
    constructor(assemblyWriter) {
        this.assemblyWriter = assemblyWriter;
        this.all = [registers.ax, registers.bx, registers.cx, registers.dx];
        this.nextUnallocated = 0;
        this.firstInaccessible = this.all.length;
    }

    borrowRegister(register, fn) {
        if (!this.isAllocated(register)) {
            return fn();
        }

        this.assemblyWriter.push(register);
        
        this
        const result = fn();
        this.assemblyWriter.pop(register);

        return result;
    }

    isAllocated(register) {
        const index = this.all.findIndex(r => r.isEqualTo(register));

        return this.nextUnallocated <= index;
    }

    callWithFreeRegister(fn) {
        if (this.nextUnallocated < this.firstInaccessible) {
            const register = this.all[this.nextUnallocated];
            this.nextUnallocated++;

            return fn(register);
        }

        this.assemblyWriter.push(registers.ax);
        const result = fn(registers.ax);
        this.assemblyWriter.pop(registers.ax);

        return result;
    }
}

exports.registers = registers;
exports.RegisterAllocator = RegisterAllocator;
