const { readFileSync, writeFileSync } = require("fs");
const { parse, transformSync } = require("@babel/core")
const generator = require("@babel/generator").default;

const helperCode = readFileSync("helpers.mjs").toString();

const { code } = transformSync(helperCode, {
	sourceType: "module",
	compact: true,
	minified: true,
	plugins: ["@babel/plugin-transform-modules-commonjs"],
	presets: ["@babel/preset-env"],
});

writeFileSync("helpers.js", code);
writeFileSync("helpers-string.js", `exports.__esModule = true;\nexports.code = ${JSON.stringify(helperCode)};\n`);
