#!/usr/bin/env bash
FILES=(samples/factorial.saw samples/unmap.saw)
for FILE in ${FILES[@]}; do
    node compile $FILE >> /dev/null 2>&1 \
        && echo "PASS $FILE" \
        || echo "FAIL $FILE"
done
