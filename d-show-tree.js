const winston = require('winston');
const { inspect, readFile } = require('./utility.js');

const cli = require('meow')(`
  Usage
    $ node d-show-tree.js <file>
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
const filename = cli.input[0];
const parse = require('./parse.js');

try {
  inspect(parse(readFile(filename)));
} catch (error) {
  if (!isSyntaxError(error)) throw error;
  winston.error(`at ${filename}:${error.location.start.line}: ${error.message}`);
  if (debugMode) {
    inspect(error);
  }
  process.exit(1);
}

function isSyntaxError(error) {
  return error.name === 'SyntaxError';
}
