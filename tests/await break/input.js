async function(foo, bar) {
	var result;
	switch (await foo()) {
		case await bar():
			result = true;
			break;
		default:
			result = false;
			break;
	}
	return result;
}
