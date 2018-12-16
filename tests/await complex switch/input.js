async function(foo, bar, baz) {
	switch (foo) {
		case 1:
		case 2:
			return 0;
		case await bar():
			if (foo)
				break;
			if (foo === 0)
				return 1;
		case 5:
			baz();
		default:
			return 2;
	}
	return 3;
}
