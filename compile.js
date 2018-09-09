#!/usr/bin/env node
const { parseFile } = require('./parse.js');
const {  isCompileError, showCompileError } = require('./utility.js');
const { generateCode } = require('./codegen.js');
const { AssemblyWriter } = require('./assembly.js');

const cli = require('meow')(`
    Usage
        $ node compile.js <file> [--debug] [--traces <families>]
`, {
    alias: {
        d: 'debug',
    },
});

require('./tracing.js').setup(cli.flags.traces ? cli.flags.traces.split(',') : []);

global.debugMode = cli.flags.debug;
const filename = cli.input[0];

if (!cli.input.length) {
    console.error('fatal: No input files.');
    process.exit(1);
}

try {
    const topLevelStatements = parseFile(filename);
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
