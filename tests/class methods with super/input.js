function() {
	class Base {
	}
	return class extends Base {
		async foo(baz) {
			return super.foo(await baz());
		}
		static async bar(baz) {
			return super.bar(await baz());
		}
	}
}
