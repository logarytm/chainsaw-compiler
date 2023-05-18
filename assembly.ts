export class AssemblyWriter {
    private output: Array<ILine>;
    private reservations: Array<{ name: string, size: number, data: number[] }>;
    private labelno: number;

    constructor() {
        this.output = [];
        this.reservations = [];
        this.labelno = 0;
    }

    comment(text) {
        this.output.push(new CommentLine(text));
    }

    createLabel(name = null) {
        if (name === null) {
            name = `L${this.labelno}$`;
            this.labelno++;
        }

        return new Label(name);
    }

    label(label: Label) {
        this.output.push(new LabelLine(label));
    }

    createAndEmitLabel(name = null) {
        const label = this.createLabel(name);
        this.label(label);

        return label;
    }

    opcode(opcode, ...operands) {
        this.output.push(new OpcodeLine(opcode, operands));
    }

    raw(instructions) {
        this.output.push(new RawLine(instructions));
    }

    dump() {
        this.output.forEach(line => {
            if (process.stdout.isTTY) {
                if (line instanceof CommentLine) {
                    console.log(`\x1b[32m${line.format()}\x1b[0m`);

                    return;
                } else if (line instanceof OpcodeLine) {
                    console.log(`\x1b[31m${line.format().replace(/(?<=\S) /, '\x1b[0m ')}\x1b[0m`);

                    return;
                }
            }

            console.log(line.format());
        });

        this.reservations.forEach(reservation => {
            console.log(`.${reservation.name}`);
            console.log(reservation.data.map(x => '    X' + x.toString(2).padStart(16, '0')).join('\n'));
        });
    }

    reserve(name, size = 1, data = []): Label {
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
                    } else if ((operand instanceof Relative || operand instanceof Absolute) && operand.target instanceof Label) {
                        label = operand.target;
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
                previousLine.opcode.toLowerCase() === 'push' && currentLine.opcode.toLowerCase() === 'pop' &&
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

interface ILine {
    format(): string;
}

class RawLine implements ILine {
    private text: string;

    constructor(text) {
        this.text = text;
    }

    format() {
        return this.text
            .trim()
            .split('\n')
            .map(x => `    ` + x.trim())
            .join('\n');
    }
}

class CommentLine implements ILine {
    private readonly text: string;

    constructor(text) {
        this.text = text;
    }

    format() {
        return `    ' ${this.text}`;
    }
}

class LabelLine implements ILine {
    public readonly label: Label;

    constructor(label) {
        this.label = label;
    }

    format() {
        return `.${this.label.name}`;
    }
}

class OpcodeLine implements ILine {
    public readonly opcode: string;
    public readonly operands: Operand[];

    constructor(opcode, operands) {
        this.opcode = opcode.toUpperCase();
        this.operands = operands;
    }

    format() {
        return '    ' + `${this.opcode} ${this.operands.map(x => x.format()).join(',')}`.trim();
    }
}

export abstract class Operand {
    protected readonly expression: any;

    constructor(expression) {
        this.expression = expression;
    }

    abstract format(): string;

    isEqualTo(other: Operand): boolean {
        return other instanceof this.constructor && other.expression === this.expression;
    }
}

export class Label extends Operand {
    get name() {
        return this.expression;
    }

    format() {
        return `.${this.expression}`;
    }

    isInternal() {
        return this.name.endsWith('$');
    }
}

export class Register extends Operand {
    public format(): string {
        return this.name;
    }

    public get name(): string {
        return this.expression.toUpperCase();
    }
}

export class Immediate extends Operand {
    public format(): string {
        return `(${this.expression})`;
    }
}

export class Absolute extends Operand {
    public format(): string {
        return `<${this.expression.format()}>`;
    }

    public get target(): any {
        return this.expression;
    }
}

export class Relative extends Operand {
    public format(): string {
        return `[${this.expression.format()}]`;
    }

    public get target(): any {
        return this.expression;
    }
}
