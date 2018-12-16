async function(count) {
	async function* sequence(until) {
		for (let i = 0; i < until; i++) {
			yield i;
		}
	}

	let result = 0;
	for await (const value of sequence(count)) {
		result += value;
	}
	return result;
}
