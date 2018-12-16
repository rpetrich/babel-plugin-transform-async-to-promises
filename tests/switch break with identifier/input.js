async function(foo) {
	exit: switch (0) {
		default:
			await foo();
			break exit;
	}
}
