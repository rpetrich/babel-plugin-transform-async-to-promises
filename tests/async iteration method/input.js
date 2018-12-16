class {
	async *sequence(until) {
		for (let i = 0; i < until; i++) {
			yield i;
		}
	}
};
