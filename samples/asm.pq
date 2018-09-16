fn main() void {
    asm
        MOV AX, BX
        MOV AX, [.foo]
    endasm
}
