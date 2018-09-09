#!/usr/bin/env bash
echo "checking code generation"
for FILE in samples/*.saw; do
    ASMFILE=${FILE/saw/asm}
    ASMFILE=${ASMFILE/samples/tmp}
    node compile $FILE > $ASMFILE 2>&1 \
        && echo "PASS $FILE $ASMFILE" \
        || (echo "FAIL $FILE" && rm $ASMFILE)
done
