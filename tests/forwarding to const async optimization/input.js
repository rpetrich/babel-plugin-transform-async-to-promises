function(value) {
	const add = async (l, r) => await l + await r;
	return async (foo) => add(1, foo);
}
