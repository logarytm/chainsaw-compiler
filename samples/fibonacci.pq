/* calculates fibonacci sequence */
fn fib(n word) word {
	/* termination */
	if n == 0 or n == 1 {
		return 1;
	} else {
		return fib(n - 1) + fib(n - 2);
	}
}
