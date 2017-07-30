const winston = require('winston');
const { inspect } = require('./utility.js');

const cli = require('meow')(`
  Usage
    $ node d-inspect.js <file> [--debug] -P | -I
`, {
  alias: {
    P: 'parseTree',
    I: 'intermediate',
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

function main() {
  const parseTree = parseFile(fileName);

  if (cli.flags.parseTree) {
    inspect(parseTree);
  } else {
    winston.error('you must provide -P or -I');
  }
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

