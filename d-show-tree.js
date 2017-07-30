const parse = require('./parse.js');
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

const debugMode = cli.flags.debug;
const filename = cli.input[0];

try {
  inspect(parse(readFile(filename)));
} catch (error) {
  if (!isSyntaxError(error)) throw error;

  winston.error(`${error.message} (at ${filename}:${error.location.start.line})`);
  if (debugMode) {
    inspect(error);
  }
  process.exit(1);
}

function isSyntaxError(error) {
  return error.name === 'SyntaxError';
}
