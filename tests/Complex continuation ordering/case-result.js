expect((await f())).toEqual(['start 1', 'start 2', 'wait 2', 'start 3', 'wait 3', 'stop 1', 'wait 3', 'stop 2', 'stop 3']);
