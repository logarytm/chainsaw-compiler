{
  const tree = new Proxy({}, {
    get(target, kind, receiver) {
      return (extra = {}) => {
        return Object.assign({ kind }, extra);
      };
    },
  });

  function nth(index) {
    return (element) => element[index];
  }

  function toString(characters) {
    if (typeof characters === 'string') return characters;
    if (!Array.isArray(characters)) {
      throw new Error(`toString() accepts string or array of strings`);
    }

    return characters
      .map(toString)
      .join('');
  }

  function toInteger(s, base) {
    // TODO: line numbers in manual errors
    if (s[0] === '_' || s[s.length - 1] === '_') {
      throw new Error('thousand separators allowed only inside numerals');
    } else if (s.includes('__')) {
      throw new Error('lolwut');
    }

    return parseInt(s.replace(/_/g, ''), base);
  }

  const openingParenthesis = '(';
  const closingParenthesis = ')';

  const left = Symbol('left');
  const right = Symbol('right');

  const operators = {
    '+': { associativity: left, precedence: 3 },
    '-': { associativity: left, precedence: 3 },
    '*': { associativity: left, precedence: 2 },
    '=': { associativity: right, precedence: 10 },
  };
}

Program
  = _ statements: TopLevelStatement* _
  { return statements; }

TopLevelStatement
  = definition: FunctionDefinition
  { return definition; }

FunctionDefinition
  = FunctionToken _
    name: Identifier _
    parameters: ParameterList _
    returnType: Type _
    body: Body
  {
    return tree.FunctionDefinition({
      name: String(name),
      parameters,
      returnType,
      body,
    });
  }

ParameterList
  = "(" _ ")" { return []; }

Body
  = "{" _ statements: Statement* "}"
  { return tree.Body({ statements }); }

Statement
  = EmptyStatement
  / expression: Expression _ StatementTerminator
  { return tree.ExpressionStatement({ expression }); }

EmptyStatement
  = StatementTerminator
  { return tree.EmptyInstruction(); }

StatementTerminator
  = ";" _

Type
  = "pointer" _ "!" _ type: Type
  { return tree.PointerToType({ type }); }
  / "array" _ "(" capacity: Expression ")" _ "!" _ type: Type
  { return tree.ArrayType({ type, capacity }); }
  / name: Identifier
  { return tree.NamedType({ name }); }

Expression
  = application: FunctionApplication
  { return application; }
  / identifier: Identifier
  { return identifier; }
  / number: Number
  { return number; }

FunctionApplication
  = name: Identifier _ args: ArgumentList
  {
    return tree.FunctionApplication({
      name: name.name,
      args,
    });
  }

ArgumentList
  = "(" _ head: Expression tail: (_ "," _ Expression)* _ ")" _
  { return [head].concat(tail.map(nth(3))); }

Identifier "identifier"
  = name: ([a-zA-Z][a-zA-Z0-9'-]*)
  { return tree.Identifier({ name: toString(name) }); }

Number
  = "0x" digits: HexadecimalDigits
  { return tree.Number({ value: toInteger(digits, 16) }); }
  / "0b" digits: BinaryDigits
  { return tree.Number({ value: toInteger(digits, 2) }); }
  / digits: Digits
  { return tree.Number({ value: toInteger(digits, 10) }); }

WhiteSpace "white space"
  = ([ \n\r\t]+)
  { }

_
  = WhiteSpace?

__
  = WhiteSpace

FunctionToken = "fn"

Digits
  = digits: [0-9_]+
  { return toString(digits); }

HexadecimalDigits
  = digits: [0-9a-f_]+
  { return toString(digits); }

BinaryDigits
  = digits: [01_]+
  { return toString(digits); }
