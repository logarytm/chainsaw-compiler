const { inspect } = require('./utility.js');

class AssemblyWriter {
    constructor() {
        this.output = [];
        this.reservations = [];
        this.knownLabels = {};
        this.labelno = 0;
    }

    comment(text) {
        this.output.push(new CommentLine(text));
    }

    prepareLabel(name = null) {
        if (name === null) {
            name = `.L${this.labelno}`;
            this.labelno++;
        }

        return new Label(name);
    }

    label(label) {
        this.output.push(new LabelLine(label));
    }

    labelHere(name = null) {
        const label = this.prepareLabel(name);
        this.label(label);

        return label;
    }

    opcode(opcode, ...operands) {
        this.output.push(new OpcodeLine(opcode, operands));
    }

    mov(where, what) {
        this.opcode('mov', where, what);
    }

    push(what) {
        this.opcode('push', what);
    }

    pop(what) {
        this.opcode('pop', what);
    }

    ret() {
        this.opcode('ret');
    }

    not(what) {
        this.opcode('not', what);
    }

    cmp(lhs, rhs) {
        this.opcode('cmp', lhs, rhs);
    }

    test(lhs, rhs) {
        this.opcode('test', lhs, rhs);
    }

    ccf() {
        this.opcode('ccf');
    }

    cof() {
        this.opcode('cof');
    }

    czf() {
        this.opcode('czf');
    }

    jmp(label) {
        this.opcode('jmp', label);
    }

    jz(label) {
        this.opcode('jz', label);
    }

    sub(lhs, rhs) {
        this.opcode('sub', lhs, rhs);
    }

    Smul6(lhs, rhs) {
        this.opcode('sys mul6', lhs, rhs);
    }

    dump() {
        this.output.forEach(line => {
            if (line instanceof LabelLine && line.label.name[0] !== 'L') {
                console.log();
            }
            console.log(line.format());
        });
        this.reservations.forEach(reservation => {
            console.log();
            console.log(`${reservation.name}:`);
            console.log(`    X${reservation.data.map(x => x.toString(2).padStart(16, '0')).join('')}`);
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
                    } else if ((operand instanceof Relative || operand instanceof Absolute) && operand.expression instanceof Label) {
                        label = operand.expression;
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

            if (
                previousLine instanceof OpcodeLine && currentLine instanceof OpcodeLine &&
                previousLine.opcode === 'push' && currentLine.opcode === 'pop' &&
                previousLine.operands[0] instanceof Register && currentLine.operands[0] instanceof Register &&
                previousLine.operands[0].isEqualTo(currentLine.operands[0])
            ) {
                newOutput.pop();
                continue;
            }

            newOutput.push(currentLine);
        }

        this.output = newOutput;
    }
}

class CommentLine {
    constructor(text) {
        this.text = text;
    }

    format() {
        return `    ; ${this.text}`;
    }
}

class LabelLine {
    constructor(label) {
        this.label = label;
    }

    format() {
        return `${this.label.name}:`;
    }
}

class OpcodeLine {
    constructor(opcode, operands) {
        this.opcode = opcode.toLowerCase();
        this.operands = operands;
    }

    format() {
        return '    ' + `${this.opcode} ${this.operands.map(x => x.format()).join(', ')}`.trim();
    }
}

class Operand {
    constructor(expression) {
        this.expression = expression;
    }

    format() {
        throw new Error(`format() not implemented for ${this.constructor.name}`);
    }
}

class Label extends Operand {
    get name() {
        return this.expression;
    }

    format() {
        return `${this.expression}`;
    }

    isInternal() {
        return this.name.startsWith('.');
    }
}

class Register extends Operand {
    format() {
        return `${this.expression}`;
    }

    isEqualTo(r) {
        return this.expression === r.expression;
    }
}

class Immediate extends Operand {
    format() {
        return `(${this.expression})`;
    }
}

class Absolute extends Operand {
    format() {
        return `<${this.expression.format()}>`;
    }
}

class Relative extends Operand {
    format() {
        return `[${this.expression.format()}]`;
    }
}

exports.AssemblyWriter = AssemblyWriter;
exports.Label = Label;
exports.Register = Register;
exports.Absolute = Absolute;
exports.Relative = Relative;
exports.Immediate = Immediate;
