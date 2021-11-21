async () => {
	while (true) {
		console.log("loop");
		await null; // important
		break;
	}
}
