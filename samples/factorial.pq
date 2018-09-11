fn putc(c word) void;
fn factorial(n word) word;

fn main() void {
    putc(41 + factorial(4));
}

fn factorial(n word) word {
	var out word = 1;
	until n < 1 {
		out = out * n;
		n = n - 1;
	}
	return out;
}
