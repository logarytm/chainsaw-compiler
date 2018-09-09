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
const { parseFile } = require('./parse.js');
const { showCompileError, isCompileError } = require('./utility.js');

    function main() {
    const parseTree = parseFile(filename);

    inspect(parseTree);
}

try {
    main();
} catch (error) {
    if (!isCompileError(error)) {
        throw error;
    }
    showCompileError(error);
    process.exit(1);
}

