/* Comment. */

fn unmap_page(addr pword, n word) pword;
fn ptes(addr pword) pword;
fn free_frame(addr pword) void;
fn peek(addr pword) word;
fn poke(addr pword, value word) word;

fn unmap_range(start /* page */ pword, size word) void {
    var message str = "hello, world";
    var i word = 0;
    var frame_allocated word;
    var physical pword;
    var e pword;
    while i < size {
        e = ptes(start + i);
        if e[0] == 0xf {
            frame_allocated = true;
            if peek(e)[3] & 4 {
                frame_allocated = false;
            }
            physical = unmap_page(start + i, 0);
            if frame_allocated {
                free_frame(physical);
            }
        }
        i = i + 0x1000;
    }
}
