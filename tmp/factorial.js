[ { kind: 'FunctionDefinition',
    location: 
     { start: 
        { offset: 0,
          line: 1,
          column: 1 },
       end: 
        { offset: 109,
          line: 8,
          column: 2 } },
    name: 'factorial',
    parameters: 
     [ { name: 
          { kind: 'Identifier',
            location: 
             { start: 
                { offset: 13,
                  line: 1,
                  column: 14 },
               end: 
                { offset: 14,
                  line: 1,
                  column: 15 } },
            name: 'n',
            toString: [Function] },
         type: 
          { kind: 'NamedType',
            location: 
             { start: 
                { offset: 15,
                  line: 1,
                  column: 16 },
               end: 
                { offset: 19,
                  line: 1,
                  column: 20 } },
            name: 'word' } } ],
    returnType: 
     { kind: 'NamedType',
       location: 
        { start: 
           { offset: 21,
             line: 1,
             column: 22 },
          end: 
           { offset: 25,
             line: 1,
             column: 26 } },
       name: 'word' },
    body: 
     { kind: 'Body',
       location: 
        { start: 
           { offset: 26,
             line: 1,
             column: 27 },
          end: 
           { offset: 109,
             line: 8,
             column: 2 } },
       statements: 
        [ { kind: 'VariableDeclaration',
            location: 
             { start: 
                { offset: 29,
                  line: 2,
                  column: 2 },
               end: 
                { offset: 46,
                  line: 2,
                  column: 19 } },
            name: 
             { kind: 'Identifier',
               location: 
                { start: 
                   { offset: 33,
                     line: 2,
                     column: 6 },
                  end: 
                   { offset: 36,
                     line: 2,
                     column: 9 } },
               name: 'out',
               toString: [Function] },
            type: 
             { kind: 'NamedType',
               location: 
                { start: 
                   { offset: 37,
                     line: 2,
                     column: 10 },
                  end: 
                   { offset: 41,
                     line: 2,
                     column: 14 } },
               name: 'word' },
            initial: null },
          { kind: 'LoopingStatement',
            location: 
             { start: 
                { offset: 48,
                  line: 3,
                  column: 2 },
               end: 
                { offset: 94,
                  line: 6,
                  column: 3 } },
            predicate: 
             { kind: 'UnaryOperator',
               location: 
                { start: 
                   { offset: 48,
                     line: 3,
                     column: 2 },
                  end: 
                   { offset: 94,
                     line: 6,
                     column: 3 } },
               operator: 'not',
               operand: 
                { kind: 'BinaryOperator',
                  location: 
                   { start: 
                      { offset: 54,
                        line: 3,
                        column: 8 },
                     end: 
                      { offset: 59,
                        line: 3,
                        column: 13 } },
                  lhs: 
                   { kind: 'Identifier',
                     location: 
                      { start: 
                         { offset: 54,
                           line: 3,
                           column: 8 },
                        end: 
                         { offset: 55,
                           line: 3,
                           column: 9 } },
                     name: 'n',
                     toString: [Function] },
                  operator: '<',
                  rhs: 
                   { kind: 'Number',
                     location: 
                      { start: 
                         { offset: 58,
                           line: 3,
                           column: 12 },
                        end: 
                         { offset: 59,
                           line: 3,
                           column: 13 } },
                     value: 1 } } },
            doBody: 
             { kind: 'Body',
               location: 
                { start: 
                   { offset: 60,
                     line: 3,
                     column: 14 },
                  end: 
                   { offset: 94,
                     line: 6,
                     column: 3 } },
               statements: 
                [ { kind: 'ExpressionStatement',
                    location: 
                     { start: 
                        { offset: 64,
                          line: 4,
                          column: 3 },
                       end: 
                        { offset: 78,
                          line: 4,
                          column: 17 } },
                    expression: 
                     { kind: 'BinaryOperator',
                       location: 
                        { start: 
                           { offset: 64,
                             line: 4,
                             column: 3 },
                          end: 
                           { offset: 77,
                             line: 4,
                             column: 16 } },
                       lhs: 
                        { kind: 'Identifier',
                          location: 
                           { start: 
                              { offset: 64,
                                line: 4,
                                column: 3 },
                             end: 
                              { offset: 67,
                                line: 4,
                                column: 6 } },
                          name: 'out',
                          toString: [Function] },
                       operator: '=',
                       rhs: 
                        { kind: 'BinaryOperator',
                          location: 
                           { start: 
                              { offset: 64,
                                line: 4,
                                column: 3 },
                             end: 
                              { offset: 77,
                                line: 4,
                                column: 16 } },
                          lhs: 
                           { kind: 'Identifier',
                             location: 
                              { start: 
                                 { offset: 70,
                                   line: 4,
                                   column: 9 },
                                end: 
                                 { offset: 73,
                                   line: 4,
                                   column: 12 } },
                             name: 'out',
                             toString: [Function] },
                          operator: '*',
                          rhs: 
                           { kind: 'Identifier',
                             location: 
                              { start: 
                                 { offset: 76,
                                   line: 4,
                                   column: 15 },
                                end: 
                                 { offset: 77,
                                   line: 4,
                                   column: 16 } },
                             name: 'n',
                             toString: [Function] } } } },
                  { kind: 'ExpressionStatement',
                    location: 
                     { start: 
                        { offset: 81,
                          line: 5,
                          column: 3 },
                       end: 
                        { offset: 91,
                          line: 5,
                          column: 13 } },
                    expression: 
                     { kind: 'BinaryOperator',
                       location: 
                        { start: 
                           { offset: 81,
                             line: 5,
                             column: 3 },
                          end: 
                           { offset: 90,
                             line: 5,
                             column: 12 } },
                       lhs: 
                        { kind: 'Identifier',
                          location: 
                           { start: 
                              { offset: 81,
                                line: 5,
                                column: 3 },
                             end: 
                              { offset: 82,
                                line: 5,
                                column: 4 } },
                          name: 'n',
                          toString: [Function] },
                       operator: '=',
                       rhs: 
                        { kind: 'BinaryOperator',
                          location: 
                           { start: 
                              { offset: 81,
                                line: 5,
                                column: 3 },
                             end: 
                              { offset: 90,
                                line: 5,
                                column: 12 } },
                          lhs: 
                           { kind: 'Identifier',
                             location: 
                              { start: 
                                 { offset: 85,
                                   line: 5,
                                   column: 7 },
                                end: 
                                 { offset: 86,
                                   line: 5,
                                   column: 8 } },
                             name: 'n',
                             toString: [Function] },
                          operator: '-',
                          rhs: 
                           { kind: 'Number',
                             location: 
                              { start: 
                                 { offset: 89,
                                   line: 5,
                                   column: 11 },
                                end: 
                                 { offset: 90,
                                   line: 5,
                                   column: 12 } },
                             value: 1 } } } } ] } },
          { kind: 'ReturnStatement',
            location: 
             { start: 
                { offset: 96,
                  line: 7,
                  column: 2 },
               end: 
                { offset: 107,
                  line: 7,
                  column: 13 } },
            expression: 
             { kind: 'Identifier',
               location: 
                { start: 
                   { offset: 103,
                     line: 7,
                     column: 9 },
                  end: 
                   { offset: 106,
                     line: 7,
                     column: 12 } },
               name: 'out',
               toString: [Function] } } ] } } ]
