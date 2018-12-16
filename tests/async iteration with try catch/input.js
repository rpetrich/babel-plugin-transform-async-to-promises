async function(count) {
	async function* sequence(until) {
		try {
			for (let i = 0; i < until; i++) {
				yield i;
			}
		} catch (e) {}
	}

	let result = 0;
	for await (const value of sequence(count)) {
		result += value;
		if (result > 10) {
			return -1;
		}
	}
	return result;
}
