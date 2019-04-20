function() {
	async function foo(result = Promise.resolve(true)) {
		return result;
	}
	return class {
		async foo(baz = this.bar()) {
			return await baz;
		}
		bar(result = foo()) {
			return result;
		}
	};
}
