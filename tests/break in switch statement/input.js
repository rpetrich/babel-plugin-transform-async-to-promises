async function() {
	await sleep(1000)
	const errorCode = 2;

	let message = 'Something wrong';

	switch (errorCode) {
		case 2:
			message = "Error 2";
			break;
	}

	for (;;) {
		break;
	}

	alert(message);
}
