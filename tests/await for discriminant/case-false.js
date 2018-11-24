async f => {
			expect((await f(async () => 0))).toBe(false);
		}