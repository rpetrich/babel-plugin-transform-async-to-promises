async function(foo) {
	let shouldContinue = true;
	let shouldContinueAsCall;
	shouldContinueAsCall = () => shouldContinue;
	while (await shouldContinueAsCall()) {
		shouldContinue = await foo();
	}
}
