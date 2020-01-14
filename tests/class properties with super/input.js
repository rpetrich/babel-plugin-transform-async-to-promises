function() {
	class Base {
		a = Promise.resolve(42)
	}

	class Sub extends Base {
		f = async () => {
			await this.a;
		}
	};

	return new B();
}