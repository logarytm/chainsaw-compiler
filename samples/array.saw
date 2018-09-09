fn fastcall peek(addr *word) word;
fn fastcall poke(addr *word, value word) word;

fn memset(array pword, value word, count word) word {
    var counter word = 0;
    while (counter < count) {
        poke(array + counter, value);
        counter = counter + 1;
    }
}

fn main() void {
    var array [10]word = 0;
    memset(array, 2137, 0);
}
