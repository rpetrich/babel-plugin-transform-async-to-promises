async function(arg) {
	try {
		const value = await arg;
		return value.missing;
	} catch (e) {
	}
	return "fallback";
}
