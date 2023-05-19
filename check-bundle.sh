#!/usr/bin/env bash
echo "checking code generation"
mkdir -p test-results
for FILE in samples/*.pq; do
    ASMFILE=${FILE/pq/asm}
    ASMFILE=${ASMFILE/samples/test-results}
    node dist/compile.js "$FILE" --traces all > "$ASMFILE" 2>&1 \
        && echo "PASS $FILE $ASMFILE" \
        || (echo "FAIL $FILE" && rm "$ASMFILE")
done
