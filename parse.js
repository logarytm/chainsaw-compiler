const winston = require('winston');
const peg = require('pegjs');

const {
    readFile,
    writeFile,
    inspect,
    isOutOfDate,
    showLocation,
} = require('./utility');

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

const parse = require(outputFilename).parse;

function parseFile(filename) {
    return parse(readFile(filename), {
        tracer: {
            trace(e) {
                // noop
            },
        }
    });
}

function isCompileError(error) {
    return error.name === 'SyntaxError' || error.constructor.name === 'SyntaxError'
        || error.constructor.name === 'CompileError';
}

function showCompileError(error) {
    console.error(`error: ${error.message} (at ${showLocation(error.location)})`);
    if (global.debugMode) {
        inspect(error);
    }
}

exports.parse = parse;
exports.parseFile = parseFile;
exports.isCompileError = isCompileError;
exports.showCompileError = showCompileError;
