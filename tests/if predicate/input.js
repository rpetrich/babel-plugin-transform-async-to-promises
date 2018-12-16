async function(foo) {
	if (await foo()) {
		return 1;
	} else {
		return 0;
	}
}
