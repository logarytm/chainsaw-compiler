# Chainsaw Language

## Syntax

```
fn main(arg int16) int16 {
  var p pointer!int16 = address(arg);
  putline("Hello, World!");
}
```

### Operator precedence

(Parentheses denote unary operators).

```
Operator                Priority      Associativity
–––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––
()                      0             n/a
(+), (-), (not)         1             left
*, /, mod               2             left
+, -, |, &              3             left
(~)                     4             left
&                       5             left
shl, shr                6             left
==, !=, >, >=, <, <=    7             left
and                     8             left
or                      9             left
=                      10             right
```
