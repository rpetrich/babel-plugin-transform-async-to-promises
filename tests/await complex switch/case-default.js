async f => {
			expect((await f(0, async () => 2))).toBe(2);
		}