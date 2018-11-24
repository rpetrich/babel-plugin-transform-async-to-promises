async f => {
			const messages = [];
			messages.push((await f(index => {
				messages.push(`waitStart${index}`);
				return Promise.resolve().then(() => messages.push(`waitStop${index}`));
			}, messages)));
			messages.push("stop");
			expect(messages).toEqual(["before-try", "start-try", "waitStart1", "waitStop1", "stop-try", "result-try", "stop"]);
		}