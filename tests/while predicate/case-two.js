async f => {
			var count = 0;
			expect((await f(async _ => {
				++count;return count < 2;
			}))).toBe(1);
			expect(count).toBe(2);
		}