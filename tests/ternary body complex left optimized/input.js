async function(a, b, c, d) {
	return a() ? b() && await c() : await d();
}
