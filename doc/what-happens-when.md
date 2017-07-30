# What happens when…

In this document, we will analyze steps undertaken by the compiler to build
this simple program:

```
/* calculates fibonacci sequence */
fn fibonacci(n int32) int32 {
	/* termination */
	if n == 0 or n == 1 {
		return 1;
	} else {
		return fib(n - 1) + fib(n - 2);
	}
}
```

## 1. Syntactical analysis

The parser is implemented using [PEG.js](https://pegjs.org/), a JavaScript
implementation of Parsing Expression Grammars. The parser code is generated from
`parse.pegjs`, which contains production rules and code building the syntax
tree.

Binary operators are handled with an [operator precedence
parser](https://en.wikipedia.org/wiki/Operator-precedence_parser).

After the parser finishes, we should have a detailed representation of the
program as an syntax tree. I'm intentionally avoiding the term “abstract” here,
because apart from structure the tree contains information about location of the
node in the source code (offset in source along with line/column numbers); this
is useful for reporting semantical errors, such as mismatched types.

We can inspect the tree generated for program with `node d-inspect.js -P <file>`.
(Files starting with `d-`, as in **d**iagnostic, offer insight to some internal
structures used by the compiler).
