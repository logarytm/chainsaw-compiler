#!/usr/bin/env bash
echo "checking code generation"
for FILE in samples/*.pq; do
    ASMFILE=${FILE/pq/asm}
    ASMFILE=${ASMFILE/samples/tmp}
    ./run $FILE --traces all > $ASMFILE 2>&1 \
        && echo "PASS $FILE $ASMFILE" \
        || (echo "FAIL $FILE" && rm $ASMFILE)
done
