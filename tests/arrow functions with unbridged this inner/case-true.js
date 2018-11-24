async f => {
			const object = {};
			expect((await f.call(object)())()).toBe(function () {
				return this;
			}());
		}