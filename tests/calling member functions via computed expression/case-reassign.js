async f => {
			const bar = {
				baz: () => true
			};
			expect((await f(() => bar.baz = () => false, bar, "baz"))).toBe(true);
		}