const winston = require('winston');
const peg = require('pegjs');

const {
  readFile,
  writeFile,
  inspect,
  showSyntaxError,
  isOutOfDate,
} = require('./utility');

const outputFileName = `${__dirname}/parse-generated.js`;
const grammarFileName = `${__dirname}/parse.pegjs`;

function regenerate() {
  winston.info('parser not found or stale, regenerating');

  let source = null;
  let startTime = new Date();
  try {
    source = peg.generate(readFile(grammarFileName), {
      output: 'source',
      format: 'commonjs',
    });
  } catch (error) {
    winston.error('during parser generation:');
    showSyntaxError(error);
    process.exit(1);
  }

  winston.info(`parser regenerated`);
  writeFile(outputFileName, source);
}

if (isOutOfDate(grammarFileName, outputFileName)) {
  regenerate();
}

const parse = require(outputFileName).parse;

exports.parse = parse;
exports.parseFile = parseFile;

function parseFile(fileName) {
  return parse(readFile(fileName));
}

exports.isSyntaxError = isSyntaxError;
function isSyntaxError(error) {
  return error.name === 'SyntaxError';
}

exports.showSyntaxError = showSyntaxError;
function showSyntaxError(error) {
  winston.error(`at line ${error.location.start.line}: ${error.message}`);
  if (global.debugMode) {
    inspect(error);
  }
}
