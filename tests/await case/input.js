async function(foo, bar) {
	switch (await foo()) {
		case await bar():
			return true;
		default:
			return false;
	}
}
