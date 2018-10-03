# Prequel

## Syntax

```
/* This function is only declared in this module. It may be defined */
/* somewhere else, for example in an assembler file. */
fn puts(string pword) void;

/* This function is declared with fastcall convention. */
fn fastcall putc() void {

    /* Inline assembly in asm..endasm blocks. */ 
    asm
        MOV DX, AX
        MOV BX, 0x1234
        OUT
    endasm
}

fn main() void {
    putc('A');
    puts("hello, world");
}
```

## How to use

```
$ ./run <file.pq>
```
