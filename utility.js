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

exports.readFile = (fileName) => fs.readFileSync(fileName, 'utf8');
exports.writeFile = fs.writeFileSync;

exports.isOutOfDate = isOutOfDate;
function isOutOfDate(prerequisiteFileName, targetFileName) {
  try {
    return lastModified(prerequisiteFileName) > lastModified(targetFileName);
  } catch (error) {
    return true;
  }
}
