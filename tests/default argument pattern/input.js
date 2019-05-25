let x = 0, z = 0;

async function f({y = (z++, {})} = (x++, {})) {
}
