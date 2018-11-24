async f => {
			expect((await f(3, async () => 3))).toBe(3);
		}