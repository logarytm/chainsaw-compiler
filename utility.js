const fs = require('fs');
const util = require('util');
const winston = require('winston');

exports.inspect = inspect;
function inspect(value) {
  console.log(util.inspect(value, {
    showHidden: false,
    depth: null,
    colors: true,
    breakLength: 20,
  }));
}

exports.lastModified = lastModified;
function lastModified(fileName) {
  return fs.statSync(fileName).mtime;
}

exports.readFile = (path) => fs.readFileSync(path, 'utf8');
exports.writeFile = fs.writeFileSync;

exports.showSyntaxError = showSyntaxError;
function showSyntaxError(error) {
  winston.error(`at line ${error.location.start.line}: ${error.message}`);
  if (global.debugMode) {
    inspect(error);
  }
}
