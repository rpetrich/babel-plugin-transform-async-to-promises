export const head = 1;
const response = await fetch("https://www.example.com/");
export const body = 2;
const json = await response.json();
export const tail = json;
