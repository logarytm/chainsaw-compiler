const winston = require('winston');
const { inspect } = require('./utility.js');

const cli = require('meow')(`
  Usage
    $ node d-show-tree.js <file> [--debug]
`, {
  alias: {
    d: 'debug',
  },
});

if (!cli.input.length) {
  console.error('error: no input files');
  process.exit(1);
}

const debugMode = global.debugMode = cli.flags.debug;
const fileName = cli.input[0];
const { showSyntaxError, isSyntaxError, parseFile } = require('./parse.js');

try {
  inspect(parseFile(fileName));
} catch (error) {
  if (!isSyntaxError(error)) {
    throw error;
  }
  showSyntaxError(error);
  process.exit(1);
}

