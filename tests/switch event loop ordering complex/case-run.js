async v => {
			expect((await v)).toEqual([['case1Start', 'waitStart', 'waitStop', 'case1Stop'], ['case2Start', 'waitStart', 'waitStop', 'case2Stop', 'case3Start', 'waitStart', 'waitStop', 'case3Stop'], ['case3Start', 'waitStart', 'waitStop', 'case3Stop']]);
		}