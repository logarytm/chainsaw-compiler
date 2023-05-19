import { Program } from './grammar';

const winston = require('winston');
const peg = require('pegjs');

const {
    readFile,
    writeFile,
    showCompileError,
    isOutOfDate,
} = require('./utils.ts');

const outputFilename = `${__dirname}/parse-generated.js`;
const grammarFileName = `${__dirname}/parse.pegjs`;

function regenerate() {
    winston.info('parser not found or stale, regenerating');

    let source = null;
    try {
        source = peg.generate(readFile(grammarFileName), {
            output: 'source',
            format: 'commonjs',
            trace: true,
        });
    } catch (error) {
        winston.error('during parser generation:');
        showCompileError(error);
        process.exit(1);
    }

    winston.info(`parser regenerated`);
    writeFile(outputFilename, source);
}

if (isOutOfDate(grammarFileName, outputFilename)) {
    regenerate();
}

export const parse = require(outputFilename).parse as (filename: string, options: {
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
