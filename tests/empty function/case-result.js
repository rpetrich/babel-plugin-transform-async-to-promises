async f => {
	const result = f();
	expect(result.constructor).toBe(Promise);
	expect((await result)).toBe(undefined);
}