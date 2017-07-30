{
  const tree = new Proxy({}, {
    get(target, kind, receiver) {
      return (extra = {}) => {
        return Object.assign({ kind }, extra);
      };
    },
  });

  function toString(characters) {
    if (typeof characters === 'string') return characters;
    if (!Array.isArray(characters)) {
      throw new Error(`toString() accepts string or array of strings`);
    }

    return characters
      .map(toString)
      .join('');
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

Expression
  = application: FunctionApplication { return application; }
  / identifier: Identifier _ { return identifier; }

FunctionApplication
  = name: Identifier _ args: ArgumentList
  {
    return tree.FunctionApplication({
      name: String(name),
      args,
    });
  }

Identifier "identifier"
  = string: ([a-zA-Z][a-zA-Z0-9'-]*)
  { return tree.Identifier({ toString: () => toString(string) }); }

ArgumentList
  = "(" _ ")" _ { return []; }

Type
  = "pointer" _ "!" _ type: Type
  { return tree.PointerToType({ type }); }
  / name: Identifier { return tree.NamedType({ name }); }

WhiteSpace
  = ([ \n\r\t]+)
  { }

_
  = WhiteSpace?

__
  = WhiteSpace

FunctionToken = "fn"
