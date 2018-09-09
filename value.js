function getReservationSize(type) {
    switch (type.kind) {
    case 'NamedType':
    case 'PointerType':
        return 1;

    case 'ArrayType':
        return type.capacity * getReservationSize(type.type);

    default:
        throw new Error(`Unknown type kind: ${type.kind}.`);
    }
}

exports.getReservationSize = getReservationSize;
