expect((await f({
    [Symbol.asyncIterator]() {
        const arr = [1, 10, 4];
        let i = 0;
        return {
            async next() {
                return {value: arr[i], done: ++i === arr.length};
            }
        };
    }
}))).toBe(11);
