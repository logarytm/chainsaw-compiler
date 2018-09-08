#!/usr/bin/env node
const { parseFile, isSyntaxError, showSyntaxError } = require('./parse.js');
const { generateCode } = require('./codegen.js');
const { AssemblyWriter } = require('./assembly.js');

const cli = require('meow')(`
    Usage
        $ node compile.js <file> [--debug]
`, {
    alias: {
        d: 'debug',
    },
});

global.debugMode = cli.flags.debug;
const filename = cli.input[0];

if (!cli.input.length) {
    console.error('error: no input file');
    process.exit(1);
}

try {
    const topLevelStatements = parseFile(filename);
    const assemblyWriter = new AssemblyWriter();
    const result = generateCode(topLevelStatements, assemblyWriter);

    if (result.success || debugMode) {
        assemblyWriter.dump();
    }

    process.exit(result.success ? 0 : 1);
} catch (e) {
    if (!isSyntaxError(e)) {
        throw e;
    }

    showSyntaxError(e);
    process.exit(1);
}
