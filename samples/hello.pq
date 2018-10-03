fn puts(str pword) void;
fn putc(c word) void;
fn main() void {
    var msg pword = "hello, world";

    puts(msg);
    putc('A');
}
