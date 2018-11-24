async f => {
			var count = 0;
			expect((await f(async _ => {
				++count;return count < 7;
			}))).toBe(true);
			expect(count).toBe(7);
		}