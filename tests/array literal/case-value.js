expect((await f(() => 1, async () => 3))).toEqual([0, 1, 2, 3, 4]);
