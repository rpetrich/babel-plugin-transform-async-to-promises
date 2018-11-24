var count = 0;
expect((await f(async _ => {
	++count;return count < 2;
}))).toBe(undefined);
expect(count).toBe(2);
