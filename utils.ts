import * as fs from 'fs';
import * as util from 'util';

declare global {
    const trace: (...args: any[]) => void;
}

export class CompileError extends Error {
    private location: object;
    private filename: string;

    constructor(message, location, filename = null) {
        super(message);
        this.location = location;
        this.filename = filename;
    }
}

export function inspect(value) {
    console.log(util.inspect(value, {
        showHidden: false,
        depth: null,
        colors: process.stdout.isTTY,
        breakLength: 20,
    }));
}

export function lastModified(filename) {
    return fs.statSync(filename).mtime;
}

export function isOutOfDate(prerequisiteFilename, targetFilename) {
    try {
        return lastModified(prerequisiteFilename) > lastModified(targetFilename);
    } catch (error) {
        return true;
    }
}

export function showLocation(location) {
    if (!isProperObject(location)) {
        return '??';
    }

    if (location.start.line === location.end.line) {
        return `${location.start.line}:${location.start.column}`;
    }

    return `${location.start.line}:${location.start.column}-${location.end.line}:${location.end.column}`;
}

export function isCompileError(error) {
    return error.name === 'SyntaxError' || error.constructor.name === 'SyntaxError'
        || error.constructor.name === 'CompileError';
}

export function showCompileError(error) {
    console.error(`${error.filename || 'stdin'}:${showLocation(error.location)}: ${error}`);
}

export function traceParseTree(nodes, level = 0, { indentFirstLine = true } = {}) {
    const isInterestingProperty = k => k !== 'kind' && k !== 'location' && k !== 'toString';

    if (!Array.isArray(nodes)) {
        nodes = [nodes];
    }

    nodes.forEach(node => {
        let indent = new Array(level + 1).join('  ');

        console.log((indentFirstLine ? indent : '') + node.kind, showLocation(node.location));
        indent += '  ';

        Object.keys(node).filter(isInterestingProperty).forEach(k => {
            const property = node[k];

            process.stdout.write(indent);

            if (isNode(property)) {
                process.stdout.write(`${k}: `);
                traceParseTree(property, level + 1, { indentFirstLine: false });
            } else if (Array.isArray(property)) {
                process.stdout.write(`${k}:\n`);
                traceParseTree(property, level + 2);
            } else {
                console.log(`${k}: ${property}`);
            }
        });
    });
}

export function isProperObject(value) {
    return typeof value === 'object' && value !== null;
}

export function isNode(object) {
    return isProperObject(object) && typeof object.kind === 'string';
}

export function nodesEqual(a, b) {
    const performDeepComparison = isProperObject(a) && isProperObject(b);

    if (performDeepComparison) {
        if ('isEqualTo' in a && typeof a.isEqualTo === 'function') {
            return a.isEqualTo(b);
        }

        return Object.keys(a)
            .filter(k => k !== 'location')
            .every(k => nodesEqual(a[k], b[k]));
    }

    return a === b;
}

export function readFile(filename): string {
    return fs.readFileSync(filename, 'UTF-8');
}