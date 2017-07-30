const winston = require('winston');
const fs = require('fs');
const peg = require('pegjs');

const { readFile, writeFile, lastModified } = require('./utility');

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
  } catch (e) {
    winston.error('during parser generation:');
    winston.info(e.stack);
    process.exit(1);
  }

  winston.info(`parser regenerated`);
  writeFile(outputFileName, source);
}

let stale = false;
try {
  if (lastModified(grammarFileName) > lastModified(outputFileName)) {
    stale = true;
  }
} catch (e) {
  stale = true;
}

if (stale) {
  regenerate();
}

module.exports = require(outputFileName).parse;
