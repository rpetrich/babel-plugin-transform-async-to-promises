async f => {
			const foo = async () => true;
			let barCalled = false;
			const bar = async () => {
				barCalled = true;
				return false;
			};
			let bazCalled = false;
			const baz = async () => {
				bazCalled = true;
			};
			expect((await f(foo, bar, baz))).toBe(true);
			expect(barCalled).toBe(false);
			expect(bazCalled).toBe(true);
		}