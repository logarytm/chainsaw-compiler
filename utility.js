const fs = require('fs');
const util = require('util');

function inspect(value) {
    console.log(util.inspect(value, {
        showHidden: false,
        depth: null,
        colors: process.stdout.isTTY,
        breakLength: 20,
    }));
}

function lastModified(filename) {
    return fs.statSync(filename).mtime;
}

function isOutOfDate(prerequisiteFilename, targetFilename) {
    try {
        return lastModified(prerequisiteFilename) > lastModified(targetFilename);
    } catch (error) {
        return true;
    }
}

function showLocation(location) {
    return `${location.start.line}:${location.start.column}-${location.end.line}:${location.end.column}`;
}

exports.readFile = (filename) => fs.readFileSync(filename, 'utf8');
exports.writeFile = fs.writeFileSync;
exports.lastModified = lastModified;
exports.isOutOfDate = isOutOfDate;
exports.inspect = inspect;
exports.showLocation = showLocation;
