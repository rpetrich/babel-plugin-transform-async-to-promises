var state;
const promise = f([1, 2], () => state = true);
state = false;
await promise;
expect(state).toBe(true);
