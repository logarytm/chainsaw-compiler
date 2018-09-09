function getReservationSize(type) {
    switch (type.kind) {
    case 'NamedType':
    case 'PointerType':
        return 1;

    case 'ArrayType':
        return type.capacity.value * getReservationSize(type.type);

    default:
        throw new Error(`Unknown type kind: ${type.kind}.`);
    }
}

class StdcallConvention {
    emitCall(declaration, args, state) {
        for (let argument of args) {
            state.callWithFreeRegister(register => {
                state.computeExpressionIntoRegister(register, argument, state);
                state.assemblyWriter.push(register);
            });
        }
    }
}

function createCallingConvention(name) {
    switch (name) {
    case 'stdcall':
        return new StdcallConvention();

    default:
        throw new Error(`Unimplemented calling convention: ${name}.`);
    }
}

exports.getReservationSize = getReservationSize;
exports.createCallingConvention = createCallingConvention;
