function() {
	return {
		async foo(bar) {
			return await bar();
		}
	};
}
