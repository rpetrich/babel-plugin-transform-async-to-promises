async function() {
	let waitIndex = 0;
	const messages = [];
	messages.push('start');

	function wait() {
		let index = ++waitIndex;

		messages.push("waitStart" + index);

		return Promise.resolve()
			.then(() => {
				messages.push("waitStop" + index);
			});
	}
	try {
		messages.push('tryStart');
		await wait();
		messages.push('tryStop');
	} catch (err) {
		messages.push('catchStart');
		await wait();
		messages.push('catchStop');
	} finally {
		messages.push('finallyStart');
		await wait();
		messages.push('finallyStop');
	}
	messages.push('stop');
	return messages;
}
