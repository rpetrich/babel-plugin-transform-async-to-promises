async function(foo) {
	for (var key in foo) {
		if (await foo[key]())
			return true;
	}
	return false
}
