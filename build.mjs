import {readFile, writeFile, mkdir} from 'node:fs/promises';
const html = await readFile(new URL('./src/admin.html', import.meta.url), 'utf8');
await writeFile(new URL('./src/ui.js', import.meta.url), `export const SETUP_HTML = ${JSON.stringify(html)};\n`);
const output = new URL('./public/products/', import.meta.url);
await mkdir(output, {recursive:true});
for (const id of ['heart','lights','speed','cap','sweat','hoodie','zip','pairtee','pairsweat']) {
  const encoded = await readFile(new URL(`./media-source/${id}.jpg.b64`, import.meta.url), 'utf8');
  const image = Buffer.from(encoded.replace(/\s/g, ''), 'base64');
  if (image[0] !== 0xff || image[1] !== 0xd8 || image.length < 10000) throw new Error(`Invalid catalogue image: ${id}`);
  await writeFile(new URL(`${id}-concept-v1.jpg`, output), image);
}
console.log('FORMULOVE: owner panel and 9 catalogue mockups prepared.');
const guides=new URL('./public/guides/',import.meta.url);await mkdir(guides,{recursive:true});
const guide=Buffer.from((await readFile(new URL('./media-source/size-guide.jpg.b64',import.meta.url),'utf8')).replace(/\s/g,''),'base64');
if(guide[0]!==0xff||guide[1]!==0xd8)throw new Error('Invalid size guide');
await writeFile(new URL('size-guide-v1.jpg',guides),guide);
