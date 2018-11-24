async f => {
			var leftCalled = false;
			await f(() => (expect(leftCalled).toBe(false), leftCalled = true), () => expect(leftCalled).toBe(true), () => "two");
			expect(leftCalled).toBe(true);
		}