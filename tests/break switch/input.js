async () => {
	const r = await test1();
	switch (r) {
		case "1":
			console.log("1111");
			break;
		case "2":
			console.log("2222");
			break;
	}
	console.log("33333333333");
}
