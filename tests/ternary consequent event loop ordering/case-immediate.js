async f => {
		var state;
		const promise = f(false, () => state = true);
		state = false;
		await promise;
		expect(state).toBe(false);
	}