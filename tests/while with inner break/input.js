async function() {
	let result = 0;
	while (true) {
		try {
			await null;
			result = 1;
			break;
		}
		catch {}
		result = 2;
	}
	return result;
}