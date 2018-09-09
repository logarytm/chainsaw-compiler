const { Register } = require('./assembly.js');

const registers = {
    ax: new Register('AX'),
    bx: new Register('BX'),
    cx: new Register('CX'),
    dx: new Register('DX'),
    bp: new Register('BP'),
};

class RegisterAllocator {
    constructor(assemblyWriter) {
        this.assemblyWriter = assemblyWriter;
        this.all = [registers.ax, registers.bx, registers.cx, registers.dx];
        this.nextUnallocated = 0;
        this.firstInaccessible = this.all.length;
    }

    borrowRegister(register, fn) {
        trace('register-borrowing', 'ignore', register.name);
        if (!this.isAllocated(register)) {
            return fn();
        }

        trace('register-borrowing', 'start', register.name);

        this.assemblyWriter.push(register);
        const result = fn();
        this.assemblyWriter.pop(register);

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
            this.nextUnallocated++;
            const result = fn(register);
            this.nextUnallocated--;

            return result;
        }

        this.assemblyWriter.push(registers.ax);
        const result = fn(registers.ax);
        this.assemblyWriter.pop(registers.ax);

        return result;
    }
}

exports.registers = registers;
exports.RegisterAllocator = RegisterAllocator;
