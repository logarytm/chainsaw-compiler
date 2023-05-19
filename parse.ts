import { Program } from './grammar';

const {
    readFile,
    writeFile,
    showCompileError,
    isOutOfDate,
} = require('./utils');

export const parse = require('./parse-generated').parse as (filename: string, options: {
    tracer: any,
}) => Program;

export function parseFile(filename: string): Program {
    return parse(readFile(filename), {
        tracer: {
            trace(e: unknown): void {
                // noop
            },
        }
    });
}
