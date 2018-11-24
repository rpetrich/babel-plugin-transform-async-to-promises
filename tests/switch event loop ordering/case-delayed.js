var state;
const promise = f(true, () => state = true);
state = false;
await promise;
expect(state).toBe(true);
