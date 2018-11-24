expect((await f(() => 1, async () => 3, () => "two"))).toEqual({ zero: 0, one: 1, two: 2, three: 3, four: 4 });
