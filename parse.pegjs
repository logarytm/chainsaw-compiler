{
  const tree = new Proxy({}, {
    get(target, kind, receiver) {
      return (extra = {}) => {
        return Object.assign({ kind }, extra);
      };
    },
  });

  const left = Symbol('left');
  const right = Symbol('right');

  const operators = {
    '+': { associativity: left },
    '-': { associativity: left },
    '*': { associativity: left },

    '=': { associativity: right },

    '==': { associativity: left },
    '!=': { associativity: left },

    'or': { associativity: left },
  };

  function isLeftAssociative(operator) {
    return operators[operator].associativity === left;
  }

  function isRightAssociative(operator) {
    return operators[operator].associativity === right;
  }

  function nth(index) {
    return (element) => element[index];
  }

  function value(v) {
    return () => v;
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

  function operatorsToTree({ head, tail }) {
    tail = tail.map((element) => {
      return {
        operator: element[1],
        rhs: element[3],
      };
    });

    function collect(lhs) {
      let operator, rhs;

      if (!tail.length) {
        return head;
      }

      while (tail.length) {
        const tmp = tail.shift(); operator = tmp.operator, rhs = tmp.rhs;
        while (tail.length && isRightAssociative(tail[0].operator)) {
          rhs = collect(rhs);
        }

        lhs = tree.BinaryOperator({
          lhs,
          operator,
          rhs,
        });
      }

      return lhs;
    }

    return collect(head);
  }
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
  = "(" _ head: NameTypePair tail: (_ "," _ NameTypePair)* _ ")" _
  { return [head].concat(tail.map(nth(3))); }

NameTypePair
  = name: Identifier __ type: Type
  { return { name, type }; }

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
  = alternative: Alternative
  { return alternative; }

Alternative
  = head: Comparative tail: (_ AlternativeOperator _ Comparative)*
  { return operatorsToTree({ head, tail }); }

Comparative
  = head: Primary tail: (_ ComparisonOperator _ Primary)*
  { return operatorsToTree({ head, tail }); }

Primary
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
      name: String(name),
      args,
    });
  }

ArgumentList
  = "(" _ head: Expression tail: (_ "," _ Expression)* _ ")" _
  { return [head].concat(tail.map(nth(3))); }

Identifier "identifier"
  = name: ([a-zA-Z][a-zA-Z0-9'-]*)
  {
    return tree.Identifier({
      name: toString(name),
      toString: value(toString(name)),
    });
  }

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
ComparisonOperator = '==' / '!=' / '<=' / '>=' / '<' / '>'
AlternativeOperator = 'or'

Digits
  = digits: [0-9_]+
  { return toString(digits); }

HexadecimalDigits
  = digits: [0-9a-f_]+
  { return toString(digits); }

BinaryDigits
  = digits: [01_]+
  { return toString(digits); }
