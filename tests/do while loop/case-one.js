async f => {
			var count = 0;
			expect((await f(async _ => {
				++count;
			}))).toBe(undefined);
			expect(count).toBe(1);
		}