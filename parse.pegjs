{
    function makeNode(node) {
        return new Proxy(node, {
            get(target, prop) {
                // special case for util.inspect() and console.log() to work
                if (prop === 'inspect') {
                    return undefined;
                }

                if (typeof prop !== 'symbol' && !(prop in target)) {
                    throw new Error(`${target.kind} has no property named ${prop}`);
                }

                return target[prop];
            },

            set(target, prop, value) {
                throw new Error('cannot change node properties');
            },

            has(target, prop) {
                return prop in target;
            },
        });
    }

    const tree = new Proxy({}, {
        get(target, kind, receiver) {
            return (extra = {}) => {
                return makeNode(Object.assign({
                    kind,
                    location: location(),
                }, extra));
            };
        },
    });

    const left = Symbol('left');
    const right = Symbol('right');

    const reservedWords = [
        'if', 'unless', 'fn', 'not', 'and', 'or', 'while', 'until', 'return',
        'var', 'const'
    ];

    const emptyBody = tree.Body({ statements: [] });

    const binaryOperators = {
        '*': { associativity: left, precedence: 60 },
        '/': { associativity: left, precedence: 60 },
        'mod': { associativity: left, precedence: 60 },

        '+': { associativity: left, precedence: 50 },
        '-': { associativity: left, precedence: 50 },
        '|': { associativity: left, precedence: 50 },
        '&': { associativity: left, precedence: 50 },

        'shl': { associativity: left, precedence: 40 },
        'shr': { associativity: left, precedence: 40 },

        '==': { associativity: left, precedence: 30 },
        '!=': { associativity: left, precedence: 30 },
        '<':    { associativity: left, precedence: 30 },
        '>':    { associativity: left, precedence: 30 },
        '<=': { associativity: left, precedence: 30 },
        '>=': { associativity: left, precedence: 30 },

        'and': { associativity: left, precedence: 20 },
        'or': { associativity: left, precedence: 10 },

        '=': { associativity: right, precedence: 0 },
    };

    function isLeftAssociative(operator) {
        return binaryOperators[operator].associativity === left;
    }

    function isRightAssociative(operator) {
        return binaryOperators[operator].associativity === right;
    }

    function precedenceOf(operator) {
        return binaryOperators[operator].precedence;
    }

    function nth(index, array = null) {
        return (element) => element[index];
    }

    function get(array, index, defaultValue = null) {
        if (Array.isArray(array) && array[index] !== undefined) {
            return array[index];
        }

        return defaultValue;
    }

    function value(v) {
        return () => v;
    }

    function checkNotReserved(word) {
        if (reservedWords.includes(word)) {
            throwSyntaxError(`unexpected reserved word ${word}`);
        }
    }

    function throwSyntaxError(message) {
        const error = new Error(message);
        error.location = location();
        error.name = "SyntaxError";

        throw error;
    }

    function toString(characters) {
        if (typeof characters === 'string') {
            return characters;
        }
        if (!Array.isArray(characters)) {
            throw new TypeError(`toString() accepts string or array of strings.`);
        }

        return characters
            .map(toString)
            .join('');
    }

    function toInteger(s, base) {
        // TODO: line numbers in manual errors
        s = toString(s);
        if (s[0] === '_' || s[s.length - 1] === '_') {
            throwSyntaxError('Thousand separators allowed only inside numerals.');
        }

        return parseInt(s.replace(/_/g, ''), base);
    }

    function notEmpty(value) {
        return value !== undefined;
    }

    function operatorsToTree({ head, tail }) {
        tail = tail.map((element) => {
            return {
                operator: element[1],
                rhs: element[3],
            };
        });

        function collect(lhs, minPrecedence) {
            let operator, rhs;

            while (tail.length && precedenceOf(tail[0].operator) >= minPrecedence) {
                const tmp = tail.shift();
                operator = tmp.operator;
                rhs = tmp.rhs;

                let lookahead = tail[0];
                while (
                    tail.length &&
                    (precedenceOf(lookahead.operator) > precedenceOf(operator) ||
                     isRightAssociative(lookahead.operator) &&
                     precedenceOf(lookahead.operator) === precedenceOf(operator))
                ) {
                    rhs = collect(rhs, precedenceOf(lookahead.operator));
                    lookahead = tail[0];
                }

                lhs = tree.BinaryOperator({
                    lhs,
                    operator,
                    rhs,
                });
            }

            return lhs;
        }

        return collect(head, 0);
    }
}

Program
    = _ statements: (TopLevelStatement _)* _
    { return statements.map(nth(0)).filter(notEmpty); }

TopLevelStatement
    = declaration: FunctionDeclaration
    { return declaration; }
    / definition: FunctionDefinition
    { return definition; }

FunctionDeclaration
    =
        "fn" _
        callingConvention: CallingConventionSpecifier _
        functionName: Identifier _
        parameters: ParameterList _
        returnType: Type _
        StatementTerminator _
    {
        return tree.FunctionDeclaration({
            functionName: String(functionName),
            callingConvention,
            parameters,
            returnType,
        });
    }

FunctionDefinition
    =
        "fn" _
        functionName: Identifier _
        callingConvention: CallingConventionSpecifier _
        parameters: ParameterList _
        returnType: Type _
        body: FunctionBody _
    {
        return tree.FunctionDefinition({
            functionName: String(functionName),
            callingConvention,
            parameters,
            returnType,
            body,
        });
    }

CallingConventionSpecifier
    = name: CallingConventionName _
    { return name; }
    / _
    { return "stdcall"; }

CallingConventionName
    = "stdcall"
    { return "stdcall"; }
    / "fastcall"
    { return "fastcall"; }

ParameterList
    = "(" _ ")" _
    { return []; }
    / "(" _ head: NameTypePair tail: (_ "," _ NameTypePair)* _ ")" _
    { return [head].concat(tail.map(nth(3))); }

NameTypePair
    = name: Identifier __ type: Type
    { return { name, type }; }

Body
    = "{" _ statements: (Statement _)* "}"
    { return tree.Body({ statements: statements.map(nth(0)).filter(notEmpty) }); }

FunctionBody
    = "{" _ statements: (FunctionStatement _)* "}"
    { return tree.FunctionBody({ statements: statements.map(nth(0)).filter(notEmpty) }); }

FunctionStatement
    =
        "var" __
        variableName: Identifier __
        variableType: Type _
        initialValue: ("=" _ Expression)? _
        StatementTerminator
    {
        return tree.VariableDeclaration({
            variableName,
            variableType,
            initialValue: get(initialValue, 3, null),
        });
    }
    / statement: Statement
    { return statement; }

Statement
    = Comment
    { }
    / EmptyStatement
    / "return" _ expression: Expression _ StatementTerminator
    { return tree.ReturnStatement({ expression }); }
    /
        keyword: ConditionalKeyword _
        predicate: Expression _
        thenBranch: Body _
        elseBranch: ("else" _ Body)?
    {
        predicate = keyword === 'unless'
            ? tree.UnaryOperator({ operator: 'not', operand: predicate })
            : predicate;

        return tree.ConditionalStatement({
            predicate,
            thenBranch,
            elseBranch: get(elseBranch, 2, emptyBody),
        });
    }
    /   keyword: LoopingKeyword _
        predicate: Expression _
        body: Body
    {
        predicate = keyword === 'until'
            ? tree.UnaryOperator({ operator: 'not', operand: predicate })
            : predicate;

        return tree.LoopingStatement({
            predicate,
            body,
        });
    }
    / expression: Expression _ StatementTerminator
    { return tree.ExpressionStatement({ expression }); }

EmptyStatement
    = StatementTerminator
    { return tree.EmptyInstruction(); }

StatementTerminator
    = ";"

Type
    = "*" _ type: Type _
    { return tree.PointerType({ type }); }
    / "[" capacity: Number "]" _ type: Type _
    { return tree.ArrayType({ type, capacity }); }
    / name: Identifier
    { return tree.NamedType({ name: String(name) }); }

Expression
    = binaryOperator: BinaryOperator
    { return binaryOperator; }

BinaryOperator
    = head: PrimaryExpression tail: (_ BinaryToken _ PrimaryExpression)*
    { return operatorsToTree({ head, tail }); }

PrimaryExpression
    = original: SecondaryExpression
      followups: SecondaryExpressionFollowup*
    {
        let expression = original;
        for (let followup of followups) {
            if (followup.kind === 'ArrayDereference') {
                followup = tree.ArrayDereference({
                    array: expression,
                    offset: followup.offset,
                });
            } else if (followup.kind === 'FunctionApplication') {
                followup = tree.FunctionApplication({
                    function: expression,
                    args: followup.args,
                });
            }

            expression = followup;
        }

        return expression;
    }

SecondaryExpression
    = "(" _ expression: Expression _ ")"
    { return expression; }
    / operator: UnaryToken _ operand: PrimaryExpression
    { return tree.UnaryOperator({ operator, operand }); }
    / identifier: Identifier
    { return identifier; }
    / number: Number
    { return number; }
    / string: String
    { return string; }

SecondaryExpressionFollowup
    = args: ArgumentList
    { return tree.FunctionApplication({ args }); }
    / "[" _ offset: PrimaryExpression "]"
    { return tree.ArrayDereference({ offset }); }

ArgumentList
    = "(" _ ")"
    { return []; }
    / "(" _ head: Expression tail: (_ "," _ Expression)* _ ")" _
    { return [head].concat(tail.map(nth(3))); }

Identifier "identifier"
    = name: ([a-zA-Z][a-zA-Z0-9_-]*)
    {
        name = toString(name);
        checkNotReserved(name);
        return tree.Identifier({
            name: name,
            toString: value(name),
        });
    }

Number
    = "0x" digits: HexadecimalDigits
    { return tree.Number({ value: toInteger(digits, 16) }); }
    / "0b" digits: BinaryDigits
    { return tree.Number({ value: toInteger(digits, 2) }); }
    / digits: Digits
    { return tree.Number({ value: toInteger(digits, 10) }); }

String
    = '"' string: StringCharacter* '"'
    { return tree.String({ string: toString(string) }); }

StringCharacter
    = "\\\\"
    { return "\\"; }
    / '\\"'
    { return '"'; }
    / "\\n"
    { return "\n"; }
    / "\\r"
    { return "\r"; }
    / "\\t"
    { return "\t"; }
    / "\\b"
    { return "\b"; }
    / "\\x" digits: ([0-9a-fA-F][0-9a-fA-F])
    { return String.fromCharCode(toInteger(digits, 16)); }
    / c: [^"]
    { return c; }

Whitespace "white space"
    = ([ \n\r\t]+)
    { }

Comment
    = "/*" (!"*/" .)* "*/"

_
    = __?

__
    = ([ \n\r\t]*) Comment ([ \n\r\t]*)
    / Whitespace

ConditionalKeyword = "if" / "unless"
LoopingKeyword = "while" / "until"
UnaryToken = "+" / "-" / "~" / "not"

BinaryToken
    = "*" / "/" / "mod"
    / "+" / "-" / "|" / "&"
    / "shl" / "shr"
    / "==" / "!=" / "<=" / ">=" / "<" / ">"
    / "and"
    / "or"
    / "="

Digits
    = digits: [0-9_]+
    { return toString(digits); }

HexadecimalDigits
    = digits: [0-9a-fA-F_]+
    { return toString(digits); }

BinaryDigits
    = digits: [01_]+
    { return toString(digits); }
