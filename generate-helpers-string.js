const { readFileSync, writeFileSync } = require("fs");

const helperCode = readFileSync("helpers.js").toString();
writeFileSync("helpers-string.js", `exports.__esModule = true;\nexports.code = ${JSON.stringify(helperCode)};\n`);
