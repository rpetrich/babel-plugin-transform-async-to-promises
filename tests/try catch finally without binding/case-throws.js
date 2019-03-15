const foo = async () => {
	throw new Error();
};
let barCalled = false;
const bar = async () => {
	barCalled = true;
	return false;
};
let bazCalled = false;
const baz = async () => {
	bazCalled = true;
};
expect((await f(foo, bar, baz))).toBe(false);
expect(barCalled).toBe(true);
expect(bazCalled).toBe(true);
