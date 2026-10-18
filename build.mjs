import {readFile, writeFile} from 'node:fs/promises';
const html = await readFile(new URL('./src/admin.html', import.meta.url), 'utf8');
await writeFile(new URL('./src/ui.js', import.meta.url), `export const SETUP_HTML = ${JSON.stringify(html)};\n`);
console.log('FORMULOVE: owner panel prepared.');
