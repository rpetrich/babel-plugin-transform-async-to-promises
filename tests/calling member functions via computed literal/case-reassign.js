const bar = {
	baz: () => true
};
expect((await f(() => bar.baz = () => false, bar))).toBe(true);
