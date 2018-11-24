async f => {
			const object = new (f())();
			expect((await object.testArguments(1))).toBe(1);
		}