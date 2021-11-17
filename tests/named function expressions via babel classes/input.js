class TestClass {
	async testMe(enabled) {
		if (!enabled) {
			return;
		}
		await doIt();
	}
}
