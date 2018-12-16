async function(foo, bar) {
	switch (foo()) {
		case 1:
			var result = await bar();
			return result || null;
		default:
			return false;
	}
}
