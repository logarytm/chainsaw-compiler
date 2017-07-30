const fs = require('fs');
const util = require('util');

exports.inspect = inspect;
function inspect(value) {
  console.log(util.inspect(value, {
    showHidden: false,
    depth: null,
    colors: true,
    breakLength: 20,
  }));
  return;
}

exports.lastModified = lastModified;
function lastModified(fileName) {
  return fs.statSync(fileName).mtime;
}

exports.readFile = (path) => fs.readFileSync(path, 'utf8');
exports.writeFile = fs.writeFileSync;
