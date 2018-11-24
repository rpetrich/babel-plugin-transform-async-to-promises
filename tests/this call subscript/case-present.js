async f => expect((await f({ bar: function () {
				return this.baz;
			}, baz: 1 }))).toBe(1)