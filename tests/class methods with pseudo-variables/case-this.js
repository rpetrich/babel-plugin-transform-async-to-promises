async f => {
			const object = new (f())();
			expect((await object.testThis())).toBe(object);
		}