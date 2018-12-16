async function() {
	const test = () => this;
	return await this.foo() + await this.bar()
}
