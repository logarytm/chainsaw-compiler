const winston = require('winston');
const { inspect } = require('./utility.js');

const cli = require('meow')(`
    Usage
        $ node d-inspect.js <file> [--debug]
`, {
    alias: {
        d: 'debug',
    },
});

if (!cli.input.length) {
    console.error('error: no input files');
    process.exit(1);
}

global.debugMode = cli.flags.debug;
const filename = cli.input[0];
const { showSyntaxError, isSyntaxError, parseFile } = require('./parse.js');

function main() {
    const parseTree = parseFile(filename);

    inspect(parseTree);
}

try {
    main();
} catch (error) {
    if (!isSyntaxError(error)) {
        throw error;
    }
    showSyntaxError(error);
    process.exit(1);
}

