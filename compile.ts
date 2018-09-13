const { parseFile } = require('./parse.ts');
import { isCompileError, showCompileError, traceParseTree } from './utils';
const { generateCode } = require('./codegen.ts');
const { AssemblyWriter } = require('./assembly.ts');

const cli = require('meow')(`
    Usage
        $ node compile.js <filename> [--debug] [--trace <families>] [--show-parse-tree]
`, {
    flags: {
        'trace': {
            type: 'string',
        },
        'show-parse-tree': {
            type: 'boolean',
        },
    },
});

require('./tracing.js').setup(cli.flags.trace ? cli.flags.trace.split(',') : []);

const debugMode = cli.flags.debug;
const filename = cli.input[0];

if (!cli.input.length) {
    console.error('fatal: No input files.');
    process.exit(1);
}

try {
    const topLevelStatements = parseFile(filename);
    if (cli.flags.showParseTree) {
        traceParseTree(topLevelStatements);
    }

    const assemblyWriter = new AssemblyWriter();
    const result = generateCode(topLevelStatements, assemblyWriter, {
        filename,
    });

    if (result.success || debugMode) {
        assemblyWriter.optimize();
        assemblyWriter.dump();
    }

    process.exit(result.success ? 0 : 1);
} catch (e) {
    if (e == null) {
        throw e;
    }

    if (!isCompileError(e)) {
        throw e;
    }

    showCompileError(e);
    console.error('fatal: Compilation aborted.');
    process.exit(1);
}
