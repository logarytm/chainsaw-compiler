import * as fs from 'fs';
import * as util from 'util';
import { AnyNode, Location } from './grammar';

declare global {
    const trace: (...args: any[]) => void;
}

export type CompileErrorLike = Error & {
    filename: string | null;
    location: Location;
};

export class CompileError extends Error {
    public readonly location: Location;
    public readonly filename: string | null;

    constructor(message: string, location: Location, filename: string | null = null) {
        super(message);
        this.location = location;
        this.filename = filename;
    }
}

export function inspect(value: any): void {
    console.log(util.inspect(value, {
        showHidden: false,
        depth: null,
        colors: process.stdout.isTTY,
        breakLength: 20,
    }));
}

export function lastModified(filename: string): Date {
    return fs.statSync(filename).mtime;
}

export function generateUniqueId(): string {
    return (((1 + Math.random()) * 0x1_0000_0000) | 0).toString(16).substring(1).padStart(8, '0');
}

export function isOutOfDate(prerequisiteFilename: string, targetFilename: string): boolean {
    try {
        return lastModified(prerequisiteFilename) > lastModified(targetFilename);
    } catch (error) {
        return true;
    }
}

export function showLocation(location: Location): string {
    if (!isProperObject(location)) {
        return '??';
    }

    if (location.start.line === location.end.line) {
        return `${location.start.line}:${location.start.column}`;
    }

    return `${location.start.line}:${location.start.column}-${location.end.line}:${location.end.column}`;
}

export function isCompileError(error: object): error is CompileErrorLike {
    return error instanceof Error && (
        error.name === 'SyntaxError'
        || error.constructor.name === 'SyntaxError'
        || error.constructor.name === 'CompileError'
    );
}

export function showCompileError(error: CompileErrorLike): void {
    console.error(`${error.filename || 'stdin'}:${showLocation(error.location)}: ${error}`);
}

export function bug(message: string): never {
    console.error(`fatal: You have encountered a compiler bug.`);
    throw new Error(`fatal: ${message}`);
}

export function traceParseTree(nodes: AnyNode | AnyNode[], level: number = 0, {
    indentFirstLine = true,
}: {
    indentFirstLine?: boolean,
} = {}) {
    const isInterestingProperty = (prop: string) => prop !== 'kind' && prop !== 'location' && prop !== 'toString';

    if (!Array.isArray(nodes)) {
        nodes = [nodes];
    }

    nodes.forEach((node: AnyNode) => {
        let indent = new Array(level + 1).join('  ');

        console.log((indentFirstLine ? indent : '') + node.kind, showLocation(node.location));
        indent += '  ';

        Object.keys(node).filter(isInterestingProperty).forEach(key => {
            const property: unknown = node[key];

            process.stdout.write(indent);

            if (isNode(property)) {
                process.stdout.write(`${key}: `);
                traceParseTree(property, level + 1, { indentFirstLine: false });
            } else if (Array.isArray(property)) {
                process.stdout.write(`${key}:\n`);
                traceParseTree(property, level + 2);
            } else {
                console.log(`${key}: ${property}`);
            }
        });
    });
}

export function isProperObject(value: unknown): value is object {
    return typeof value === 'object' && value !== null;
}

// This a separate function purely for typing purposes.
export function isIndexableObject(value: unknown): value is { [key: string]: any } {
    return typeof value === 'object' && value !== null;
}

export function isNode(object: unknown): object is AnyNode {
    return isIndexableObject(object) && object.hasOwnProperty('kind') && typeof object.kind === 'string';
}
export function nodesEqual(left: any, right: any): boolean {
    const performDeepComparison = isIndexableObject(left) && isIndexableObject(right);

    if (performDeepComparison) {
        if ('isEqualTo' in left && typeof left.isEqualTo === 'function') {
            const result = left.isEqualTo(right);

            if (typeof result === 'boolean') {
                return result;
            }

            // If isEqualTo() didn't return a boolean, it means it does not support the comparison.
        }

        return Object.keys(left)
            .filter(key => key !== 'location')
            .filter(key => key in right)
            .every(key => nodesEqual(left[key], right[key]));
    }

    return left === right;
}

export function readFile(filename: string): string {
    return fs.readFileSync(filename, 'utf-8');
}

export function writeFile(filename: string, content: string): void {
    fs.writeFileSync(filename, content, { encoding: 'utf-8' });
}
