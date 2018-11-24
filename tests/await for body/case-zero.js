async f => {
			expect((await f(() => 1, async () => 0))).toBe(0);
		}