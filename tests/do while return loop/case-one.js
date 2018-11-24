async f => {
			var count = 0;
			expect((await f(async _ => {
				++count;
			}))).toBe(true);
			expect(count).toBe(1);
		}