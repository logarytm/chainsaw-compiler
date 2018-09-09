const fs = require('fs');
const util = require('util');

class CompileError extends Error {
    constructor(message, location, filename = null) {
        super(message);
        this.location = location;
        this.filename = filename;
    }
}

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
    if (location.start.line === location.end.line) {
        return `${location.start.line}:${location.start.column}`;
    }

    return `${location.start.line}:${location.start.column}-${location.end.line}:${location.end.column}`;
}

function isCompileError(error) {
    return error.name === 'SyntaxError' || error.constructor.name === 'SyntaxError'
        || error.constructor.name === 'CompileError';
}

function showCompileError(error) {
    console.error(`${error.filename || 'stdin'}:${showLocation(error.location)}: ${error.message}`);
    if (global.debugMode) {
        inspect(error);
    }
}

exports.CompileError = CompileError;
exports.readFile = (filename) => fs.readFileSync(filename, 'utf8');
exports.writeFile = fs.writeFileSync;
exports.lastModified = lastModified;
exports.isOutOfDate = isOutOfDate;
exports.inspect = inspect;
exports.showLocation = showLocation;
exports.isCompileError = isCompileError;
exports.showCompileError = showCompileError;
