async f => {
			var obj = { bar: async _ => 0, baz: async _ => 1 };
			expect(JSON.stringify((await f(obj)))).toBe(`[0,1]`);
		}