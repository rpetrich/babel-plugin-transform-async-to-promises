async f => expect((await f({ bar: function () {
				return this.baz;
			} }))).toBe(undefined)