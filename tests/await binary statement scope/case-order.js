let lastCalled = 0;
await f(() => lastCalled = 1, () => lastCalled = 2);
expect(lastCalled).toBe(2);
