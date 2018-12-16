async function(foo, bar) {
	switch (foo()) {
		case 1:
			return await bar();
		default:
			return false;
	}
}
