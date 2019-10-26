async function() {
	let result = 0;
	while (true) {
		try {
			await null;
			result = 1;
			break;
		} catch (e) {
		}
		result = 2;
	}
	return result;
}