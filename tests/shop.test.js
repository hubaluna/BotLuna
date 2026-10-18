import {test,beforeEach,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {D1} from './d1.js';
import {Shop,initialize,run,first,all,phone,ShopError,money} from '../src/core.js';
import {Bot,drain,receipt} from '../src/bot.js';
import worker,{webhookSecret} from '../src/worker.js';
import {STORE_COPY_UPDATES,PRODUCT_COPY_UPDATES} from '../src/copy.js';

let db,env,shop,calls,originalFetch,updateId=1;
beforeEach(async()=>{
 db=new D1();env={DB:db,BOT_TOKEN:'123456:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',SETUP_KEY:'test-setup-key-012345678901234567890123456789',ADMIN_IDS:'900'};
 await initialize(db);shop=await new Shop(env).load();calls=[];originalFetch=globalThis.fetch;
 globalThis.fetch=async(url,options)=>{const method=String(url).split('/').at(-1);const data=typeof options?.body==='string'?JSON.parse(options.body):{};calls.push({method,data});const result=method==='getMe'?{id:123456,username:'formulove_test_bot'}:method==='getWebhookInfo'?{url:'',pending_update_count:0}:{message_id:calls.length};return Response.json({ok:true,result});};
});
afterEach(()=>{globalThis.fetch=originalFetch;db.close();});
const customer=()=>({name:'Олена Тестова',phone:'+380671234567',city:'Київ',delivery:'branch',branch:'Відділення 12',payment:'cod',package:'standard',consent:true,comment:''});
const key='heart:black:M:';
async function add(uid=1,k=key){return shop.changeCart(uid,k,1,'op:'+updateId++);}
async function place(uid=1,token='token'+updateId++){await add(uid);const q=await shop.quote(uid);return (await shop.place(uid,token,customer(),q.fingerprint)).order;}
async function message(text,uid=1,extra={}){return new Bot(shop,uid,updateId++).handle({message:{from:{id:uid},chat:{id:uid,type:'private'},text,...extra}});}
async function cb(data,uid=1){return new Bot(shop,uid,updateId++).handle({callback_query:{id:'q',from:{id:uid},data,message:{chat:{id:uid,type:'private'}}}});}
async function setup(path,data={},keyValue=env.SETUP_KEY,origin='https://bot.example.com'){return worker.fetch(new Request('https://bot.example.com/setup/'+path,{method:'POST',headers:{Authorization:'Bearer '+keyValue,'Content-Type':'application/json',Origin:origin},body:JSON.stringify(data)}),env);}

test('initialization seeds 9 products and is non-destructive',async()=>{assert.equal(Object.keys(shop.products).length,9);await run(db,"UPDATE products SET price=1290 WHERE id='heart'");await initialize(db);assert.equal((await first(db,"SELECT price FROM products WHERE id='heart'")).price,1290);assert.equal((await all(db,'SELECT * FROM stock')).length,189);});
test('phone normalization rejects malformed contacts',()=>{assert.equal(phone('067 123-45-67'),'+380671234567');for(const s of ['abc','+48123456789','38067','067123456789'])assert.throws(()=>phone(s),ShopError);});
test('pair needs two independently selected sizes',async()=>{assert.throws(()=>shop.variant('pairtee','duo','S'),ShopError);const k=shop.variant('pairtee','duo','S','XL');await add(1,k);assert.match((await shop.quote(1)).items[0].label,/S \/ XL/);});
test('integer totals include gift packaging once',async()=>{await add();await add();const q=await shop.quote(1,'gift');assert.equal(q.total,2480);assert.equal(q.packaging,100);assert.equal(money(q.total),'2 480 грн');});
test('cart mutations are retry-safe',async()=>{await shop.changeCart(1,key,1,'same');await shop.changeCart(1,key,1,'same');assert.equal((await shop.cart(1))[0].quantity,1);});
test('decrement 2 becomes 1 then removes 1 without going negative',async()=>{await add();await add();await shop.changeCart(1,key,-1,'minus1');assert.equal((await shop.cart(1))[0].quantity,1);await shop.changeCart(1,key,-1,'minus2');assert.equal((await shop.cart(1)).length,0);});
test('maximum quantity returns CART_LIMIT instead of a poisoned retry',async()=>{for(let i=0;i<10;i++)await add();await assert.rejects(add(),/CART_LIMIT/);assert.equal((await shop.cart(1))[0].quantity,10);});
test('stock reservation and order are atomic under competing buyers',async()=>{await run(db,'UPDATE stock SET quantity=1 WHERE variant=?',[key]);await add(1);await add(2);const q1=await shop.quote(1),q2=await shop.quote(2);await shop.place(1,'winner',customer(),q1.fingerprint);await assert.rejects(shop.place(2,'loser',customer(),q2.fingerprint));assert.equal(await shop.stock(key),0);assert.equal((await all(db,'SELECT * FROM orders')).length,1);assert.equal((await shop.cart(2)).length,1);});
test('double confirmation gives one order and one inventory reservation',async()=>{await run(db,'UPDATE stock SET quantity=3 WHERE variant=?',[key]);await add();const q=await shop.quote(1);const a=await shop.place(1,'sameorder',customer(),q.fingerprint),b=await shop.place(1,'sameorder',customer(),q.fingerprint);assert.equal(a.order.id,b.order.id);assert.equal(b.created,false);assert.equal(await shop.stock(key),2);assert.equal((await all(db,'SELECT * FROM orders')).length,1);});
test('order token belongs to one buyer',async()=>{const o=await place(1,'private');await assert.rejects(shop.place(2,'private',customer(),'x'),ShopError);assert.equal(o.user_id,1);});
test('DB transaction catches a price change even if Worker snapshot is stale',async()=>{await add();const q=await shop.quote(1);await run(db,"UPDATE products SET price=1300 WHERE id='heart'");await assert.rejects(shop.place(1,'changedprice',customer(),q.fingerprint),/PRICE_CHANGED/);assert.equal((await all(db,'SELECT * FROM orders')).length,0);assert.equal((await shop.cart(1)).length,1);});
test('changing store terms between review and confirmation forces fresh review',async()=>{await add();const q=await shop.quote(1);const other=await new Shop(env).load();await other.saveConfig({...other.store,dispatch_text:'Нові строки'},{currency:'UAH',categories:other.categories,products:Object.values(other.products)});await assert.rejects(shop.place(1,'changedterms',customer(),q.fingerprint),/CONFIG_CHANGED/);});
test('mode changes of inventory cannot corrupt cancellation accounting',async()=>{await add();const q=await shop.quote(1);await run(db,'UPDATE stock SET quantity=5 WHERE variant=?',[key]);await assert.rejects(shop.place(1,'modechange',customer(),q.fingerprint));assert.equal(await shop.stock(key),5);});
test('consent required',async()=>{await add();const q=await shop.quote(1);await assert.rejects(shop.place(1,'noconsent',{...customer(),consent:false},q.fingerprint),ShopError);});
test('cancel releases stock once and preserves another buyer privacy',async()=>{await run(db,'UPDATE stock SET quantity=3 WHERE variant=?',[key]);const o=await place();await assert.rejects(shop.status(o.id,'cancelled',2,{buyer:true}),ShopError);await shop.status(o.id,'cancelled',1,{buyer:true});assert.equal(await shop.stock(key),3);await assert.rejects(shop.status(o.id,'cancelled',1,{buyer:true}),ShopError);assert.equal(await shop.stock(key),3);});
test('admin statuses restricted and shipping needs real-format TTN',async()=>{const o=await place();await assert.rejects(shop.status(o.id,'confirmed',1),ShopError);await shop.status(o.id,'confirmed',900);await shop.status(o.id,'processing',900);await assert.rejects(shop.status(o.id,'shipped',900,{tracking:'bad'}),ShopError);await shop.status(o.id,'shipped',900,{tracking:'20450000000000'});assert.equal((await shop.order(o.id)).tracking,'20450000000000');});
test('buyer order card has cancellation button and no admin controls',async()=>{const o=await place();await cb('order:'+o.id);const reply=calls.filter(c=>c.method==='sendMessage').at(-1);assert(reply.data.reply_markup.inline_keyboard.flat().some(b=>b.callback_data==='cancelask:'+o.id));assert(!reply.data.reply_markup.inline_keyboard.flat().some(b=>b.callback_data?.startsWith('status')));await assert.rejects(cb('order:'+o.id,2),ShopError);});
test('contact of a third person must be typed manually',async()=>{await add();await cb('checkout');await message('Олена Тестова');await assert.rejects(message('',1,{contact:{user_id:2,phone_number:'+380671234567'}}),ShopError);assert.equal((await shop.session(1)).step,'phone');});
test('full buyer flow with distinct pair sizes and gift packaging',async()=>{await cb('add2:pairtee:duo:S:XL');await cb('checkout');await message('Олена Тестова');await message('0671234567');await message('Київ');await cb('delivery:branch');await message('Відділення 12');await cb('package:gift');await cb('payment:cod');await cb('skipcomment');await cb('consent');const token=(await shop.session(1)).token;await cb('place:'+token);await cb('place:'+token);const orders=await all(db,'SELECT * FROM orders');assert.equal(orders.length,1);assert.equal(orders[0].total,2290);const o=await shop.order(orders[0].id);assert.match(o.items[0].label,/S \/ XL/);await drain(shop);assert.equal((await all(db,"SELECT * FROM outbox WHERE state!='done'")).length,0);});
test('real picture uploads keep Telegram file IDs, not copies or tokens in code',async()=>{await message('',900,{text:undefined,caption:'/asset welcome',document:{mime_type:'image/png',file_id:'original-full-image-file'}});assert.equal((await first(db,"SELECT * FROM assets WHERE key='welcome'")).kind,'document');await message('',900,{text:undefined,caption:'/photo heart',photo:[{file_id:'small'},{file_id:'large'}]});assert.equal((await first(db,"SELECT * FROM assets WHERE key='product:heart'")).file_id,'large');});
test('live gate prevents unconfirmed catalogue',async()=>{assert(shop.liveIssues().length>0);await assert.rejects(shop.saveConfig({...shop.store,mode:'live'},{currency:'UAH',categories:shop.categories,products:Object.values(shop.products)}),ShopError);assert.equal(JSON.parse((await first(db,"SELECT value FROM settings WHERE key='store'")).value).mode,'demo');});
test('setup is authenticated and does not reveal secrets',async()=>{let r=await worker.fetch(new Request('https://bot.example.com/setup'),env);const html=await r.text();assert(!html.includes(env.BOT_TOKEN));assert(!html.includes(env.SETUP_KEY));r=await setup('state',{},'wrong');assert.equal(r.status,401);r=await setup('state',{},env.SETUP_KEY,'https://attacker.example');assert.equal(r.status,403);r=await setup('state');assert.equal(r.status,200);const state=await r.json();assert(!JSON.stringify(state).includes(env.BOT_TOKEN));assert.equal(state.catalog.products.length,9);});
test('webhook registration uses secret header, retains pending updates and one connection',async()=>{const r=await setup('connect');assert.equal(r.status,200);const request=calls.find(c=>c.method==='setWebhook').data;assert.equal(request.url,'https://bot.example.com/telegram/webhook');assert.notEqual(request.secret_token,env.SETUP_KEY);assert.equal(request.secret_token,await webhookSecret(env));assert.equal(request.max_connections,1);assert.equal(request.drop_pending_updates,false);});
test('unsigned webhook never touches D1',async()=>{db.queries=0;const r=await worker.fetch(new Request('https://bot.example.com/telegram/webhook',{method:'POST',body:JSON.stringify({update_id:1})}),env);assert.equal(r.status,403);assert.equal(db.queries,0);});
test('signed Telegram update is deduplicated and stays below free D1 query limit',async()=>{const update={update_id:500,message:{from:{id:1},chat:{id:1,type:'private'},text:'/id'}};const make=()=>new Request('https://bot.example.com/telegram/webhook',{method:'POST',headers:{'X-Telegram-Bot-Api-Secret-Token':awaitedSecret,'Content-Type':'application/json'},body:JSON.stringify(update)});const awaitedSecret=await webhookSecret(env);db.queries=0;let r=await worker.fetch(make(),env);assert.equal(r.status,200);assert(db.queries<50);const n=calls.filter(c=>c.method==='sendMessage').length;r=await worker.fetch(make(),env);assert.equal(r.status,200);assert.equal(calls.filter(c=>c.method==='sendMessage').length,n);});
test('notification errors retain durable outbox',async()=>{await place();globalThis.fetch=async()=>Response.json({ok:false,error_code:429,parameters:{retry_after:10}},{status:429});await drain(shop);const pending=await all(db,"SELECT * FROM outbox WHERE state='pending'");assert.equal(pending.length,2);assert(pending.every(r=>r.attempts===1));});
test('receipt escapes buyer content',async()=>{await add();const q=await shop.quote(1);const {order}=await shop.place(1,'safe',{...customer(),comment:'<b>test</b>'},q.fingerprint);assert(receipt(order,true).includes('&lt;b&gt;test&lt;/b&gt;'));});
test('button callback lengths and message lengths match Telegram limits',async()=>{shop.env.PUBLIC_BASE_URL='https://shop.workers.dev';for(const p of Object.values(shop.products)){await new Bot(shop,1,updateId++).product(p.id);for(const c of p.colors)await new Bot(shop,1,updateId++).sizes(p.id,c.id,p.pair?p.sizes[0]:'');}await message('/all');for(const c of calls){if(c.method==='sendMessage')assert(c.data.text.length<=4096);if(c.data.caption)assert(c.data.caption.length<=1024);for(const item of c.data.media||[])assert(item.caption.length<=1024);for(const row of c.data.reply_markup?.inline_keyboard||[])for(const b of row)if(b.callback_data)assert(Buffer.byteLength(b.callback_data)<=64);}});


test('tee cards use clean product captions and keep made-to-order information',async()=>{
 env.PUBLIC_BASE_URL='https://my-store.workers.dev';shop.env.PUBLIC_BASE_URL=env.PUBLIC_BASE_URL;
 for(const id of ['heart','lights','speed'])await new Bot(shop,1,updateId++).product(id);
 const photos=calls.filter(c=>c.method==='sendPhoto');assert.equal(photos.length,3);
 assert.deepEqual(photos.map(c=>c.data.photo),['heart','lights','speed'].map(id=>'https://my-store.workers.dev/products/'+id+'-concept-v1.jpg'));
 for(const c of photos){assert(!c.data.caption.includes('Візуалізація'));assert(c.data.caption.length<=1024);assert(c.data.caption.includes('Виготовлення під замовлення.'));assert(c.data.reply_markup.inline_keyboard.flat().some(b=>b.callback_data==='cart'));}assert.equal(calls.filter(c=>c.method==='sendMessage').length,0);
 assert.equal((await first(db,"SELECT data FROM products WHERE id='heart'")).data.includes('concept-v1'),false);
});
test('owner Telegram photo overrides both a catalogue URL and a bundled mockup',async()=>{
 env.PUBLIC_BASE_URL='https://my-store.workers.dev';shop.env.PUBLIC_BASE_URL=env.PUBLIC_BASE_URL;shop.products.heart.photo='https://owner.example.com/tee.jpg';
 shop.assets['product:heart']={kind:'photo',file_id:'owner-original-telegram-file'};
 await new Bot(shop,1,updateId++).product('heart');
 const photo=calls.find(c=>c.method==='sendPhoto');assert.equal(photo.data.photo,'owner-original-telegram-file');assert(!photo.data.caption.includes('Візуалізація'));
});
test('owner catalogue photo is retained and no mockup is used for a missing live photo',async()=>{
 env.PUBLIC_BASE_URL='https://my-store.workers.dev';shop.env.PUBLIC_BASE_URL=env.PUBLIC_BASE_URL;shop.products.heart.photo='https://owner.example.com/tee.jpg';
 await new Bot(shop,1,updateId++).product('heart');assert.equal(calls.find(c=>c.method==='sendPhoto').data.photo,'https://owner.example.com/tee.jpg');
 calls.length=0;shop.store.mode='live';shop.store.sales_mode='ready';shop.products.heart.photo='';
 await new Bot(shop,1,updateId++).product('heart');assert.equal(calls.filter(c=>c.method==='sendPhoto').length,0);
});
test('signed product webhook derives image URL from request instead of an account-specific constant',async()=>{
 const update={update_id:9001,callback_query:{id:'photo',from:{id:1},data:'product:lights',message:{chat:{id:1,type:'private'}}}};
 const request=new Request('https://another-store.workers.dev/telegram/webhook',{method:'POST',headers:{'X-Telegram-Bot-Api-Secret-Token':await webhookSecret(env),'Content-Type':'application/json'},body:JSON.stringify(update)});
 const r=await worker.fetch(request,env);assert.equal(r.status,200);
 assert.equal(calls.find(c=>c.method==='sendPhoto').data.photo,'https://another-store.workers.dev/products/lights-concept-v1.jpg');
});
test('a Telegram photo fetch failure still leaves a usable product card',async()=>{
 env.PUBLIC_BASE_URL='https://my-store.workers.dev';shop.env.PUBLIC_BASE_URL=env.PUBLIC_BASE_URL;const fetchOk=globalThis.fetch;
 globalThis.fetch=async(url,options)=>String(url).endsWith('/sendPhoto')?Response.json({ok:false,error_code:400},{status:400}):fetchOk(url,options);
 await new Bot(shop,1,updateId++).product('heart');
 assert(calls.some(c=>c.method==='sendMessage'&&c.data.reply_markup.inline_keyboard.flat().some(b=>b.callback_data==='color:heart:black')));
});


test('live preorders accept disclosed mockups and absent measurements with a real owner ID',async()=>{
 const noSecret={...env};delete noSecret.ADMIN_IDS;const current=await new Shop(noSecret).load();
 const store={...current.store,mode:'live',sales_mode:'preorder',admin_ids:'901',catalog_confirmed:true,terms_confirmed:true,images_are_concepts:true};
 await current.saveConfig(store,{currency:'UAH',categories:current.categories,products:Object.values(current.products)});
 assert.deepEqual(current.liveIssues(),[]);assert.equal(current.env.ADMIN_IDS,'901');
 await current.changeCart(1,key,1,'preorder-live');const q=await current.quote(1);
 const {order}=await current.place(1,'real-preorder',customer(),q.fingerprint);
 assert.equal(order.mode,'live');assert.equal(order.customer.sale_type,'preorder');assert.match(order.customer.preorder_notice,/до оплати/);
 const text=receipt(order,true);assert.match(text,/Виготовлення під замовлення/);assert(!text.includes('ТЕСТОВЕ ЗАМОВЛЕННЯ'));
 assert.deepEqual(JSON.parse((await first(db,'SELECT admin_targets FROM orders WHERE id=?',[order.id])).admin_targets),[901]);
});
test('ready stock mode still requires real sample photos and measurements',async()=>{
 shop.store={...shop.store,mode:'live',sales_mode:'ready',catalog_confirmed:true,terms_confirmed:true};
 assert(shop.liveIssues().some(x=>x.includes('фото')));
 await assert.rejects(shop.saveConfig(shop.store,{currency:'UAH',categories:shop.categories,products:Object.values(shop.products)}),ShopError);
});
test('an invalid or missing numeric owner ID cannot activate live preorders',async()=>{
 const noSecret={...env};delete noSecret.ADMIN_IDS;const current=await new Shop(noSecret).load();
 const base={...current.store,mode:'live',sales_mode:'preorder',catalog_confirmed:true,terms_confirmed:true};const c={currency:'UAH',categories:current.categories,products:Object.values(current.products)};
 await assert.rejects(current.saveConfig({...base,admin_ids:''},c),ShopError);
 await assert.rejects(current.saveConfig({...base,admin_ids:'@da_martin'},c),ShopError);
});
test('Cloudflare ADMIN_IDS remains authoritative over panel fallback',async()=>{
 await shop.saveConfig({...shop.store,admin_ids:'901'},{currency:'UAH',categories:shop.categories,products:Object.values(shop.products)});
 assert.equal(shop.env.ADMIN_IDS,'900');
});
test('every live preorder product keeps a short fulfillment label with clean image captions',async()=>{
 env.PUBLIC_BASE_URL='https://shop.workers.dev';shop.env.PUBLIC_BASE_URL=env.PUBLIC_BASE_URL;shop.store.mode='live';shop.store.sales_mode='preorder';
 for(const p of Object.values(shop.products))await new Bot(shop,1,updateId++).product(p.id);
 const photos=calls.filter(c=>c.method==='sendPhoto');assert.equal(photos.length,9);for(const p of photos){assert(!p.data.caption.includes('Візуалізація'));assert(p.data.caption.includes('Виготовлення під замовлення.'));assert(p.data.caption.length<=1024);}assert.equal(calls.filter(c=>c.method==='sendMessage').length,0);
});
test('stored preorder conditions remain visible after later catalogue changes',async()=>{
 const o=await place();shop.store.sales_mode='ready';
 const saved=await shop.order(o.id);assert.equal(saved.customer.sale_type,'preorder');assert.match(receipt(saved),/строк відправлення/);
});


test('live storefront avoids technical image notices and confirms fulfillment before ordering',async()=>{
 shop.store.mode='live';shop.store.catalog_confirmed=true;shop.store.terms_confirmed=true;shop.env.PUBLIC_BASE_URL='https://shop.workers.dev';
 await new Bot(shop,1,updateId++).home();await new Bot(shop,1,updateId++).product('heart');
 const messages=calls.map(c=>c.data.text||c.data.caption||'').join('\n');
 for(const term of ['Візуалізація','не фото','Демонстраційний','зразок ще не затверджено'])assert(!messages.includes(term));
 assert(messages.includes('Виготовлення під замовлення.'));assert(!messages.includes('є в наявності'));
 await add();const order=await place(1,'polished-copy');const text=receipt(order);assert(text.includes('до оплати'));assert(!text.includes('Візуалізація'));
});

const inline=c=>c.data.reply_markup?.inline_keyboard?.flat()||[];
const sent=()=>calls.filter(c=>['sendMessage','sendPhoto','sendDocument','sendMediaGroup'].includes(c.method));
const galleryImages=()=>calls.filter(c=>c.method==='sendMediaGroup').flatMap(c=>c.data.media);

test('start sends one welcome with the all-designs entry point and leaves the cart intact',async()=>{
 await add();await cb('checkout');calls.length=0;await message('/start');
 assert.equal(sent().length,1);assert(sent()[0].data.text.length<300);
 assert(sent()[0].data.reply_markup.keyboard.flat().some(b=>b.text==='Показати все'));
 assert.equal((await shop.cart(1)).length,1);assert(!(await shop.session(1)).step);
});
test('welcome image carries the same menu without sending a second message',async()=>{
 shop.assets.welcome={kind:'photo',file_id:'welcome-original'};await message('/start');
 assert.equal(sent().length,1);assert.equal(sent()[0].method,'sendPhoto');assert(sent()[0].data.reply_markup.keyboard);
});
test('all nine designs are one native album followed by numbered selection buttons',async()=>{
 shop.env.PUBLIC_BASE_URL='https://shop.workers.dev';await message('Показати все');
 const albums=calls.filter(c=>c.method==='sendMediaGroup');assert.equal(albums.length,1);assert.equal(albums[0].data.media.length,9);
 const choices=calls.filter(c=>c.method==='sendMessage');assert.equal(choices.length,1);
 const products=Object.values(shop.products),buttons=inline(choices[0]).filter(b=>b.callback_data?.startsWith('product:'));
 assert.equal(buttons.length,9);
 for(const [i,p] of products.entries()){assert.equal(buttons[i].callback_data,'product:'+p.id);assert(buttons[i].text.startsWith((i+1)+'. '));assert(albums[0].data.media[i].caption.startsWith((i+1)+'. '+p.name));assert(albums[0].data.media[i].caption.includes(money(p.price_uah)));assert.equal(albums[0].data.media[i].caption.includes('за дві речі'),p.pair);}
 calls.length=0;await cb(buttons[8].callback_data);assert(sent()[0].data.caption.includes(shop.products.pairsweat.name));
});
test('catalogue and category expose gallery buttons without adding unwanted products',async()=>{
 shop.env.PUBLIC_BASE_URL='https://shop.workers.dev';await message('/catalog');assert(inline(sent()[0]).some(b=>b.callback_data==='all:0'));
 calls.length=0;const category=shop.products.heart.category;await cb('cat:'+category);assert(inline(sent()[0]).some(b=>b.callback_data==='all:0:'+category));
 calls.length=0;await cb('all:0:'+category);assert.equal(galleryImages().length,Object.values(shop.products).filter(p=>p.active&&p.category===category).length);
 assert(galleryImages().every(m=>['heart','lights','speed'].some(id=>m.media.endsWith('/'+id+'-concept-v1.jpg'))));
});
test('hidden products do not leak into gallery images or selection buttons',async()=>{
 shop.env.PUBLIC_BASE_URL='https://shop.workers.dev';shop.products.lights.active=false;await message('/all');
 assert.equal(galleryImages().length,8);assert(!galleryImages().some(m=>m.media.includes('/lights-')));
 assert(!calls.some(c=>inline(c).some(b=>b.callback_data==='product:lights')));
});
test('gallery uses owner photos before catalogue URLs and bundled images',async()=>{
 shop.env.PUBLIC_BASE_URL='https://shop.workers.dev';shop.products.heart.photo='https://owner.example.com/heart.jpg';shop.assets['product:heart']={kind:'photo',file_id:'uploaded-heart'};
 shop.products.lights.photo='https://owner.example.com/lights.jpg';await message('/all');
 assert.equal(galleryImages()[0].media,'uploaded-heart');assert.equal(galleryImages()[1].media,'https://owner.example.com/lights.jpg');
});
test('uploaded image files form a separate document album as required by Telegram',async()=>{
 shop.env.PUBLIC_BASE_URL='https://shop.workers.dev';for(const id of ['heart','lights'])shop.assets['product:'+id]={kind:'document',file_id:'file-'+id};
 await message('/all');const albums=calls.filter(c=>c.method==='sendMediaGroup');assert.equal(albums.length,2);
 assert.equal(albums[0].data.media.length,7);assert(albums[0].data.media.every(m=>m.type==='photo'));
 assert.equal(albums[1].data.media.length,2);assert(albums[1].data.media.every(m=>m.type==='document'));
});
test('one gallery image uses a single photo and an empty catalogue remains usable',async()=>{
 shop.env.PUBLIC_BASE_URL='https://shop.workers.dev';for(const p of Object.values(shop.products))p.active=p.id==='heart';await message('/all');
 assert.equal(calls.filter(c=>c.method==='sendMediaGroup').length,0);assert.equal(calls.filter(c=>c.method==='sendPhoto').length,1);assert(inline(sent().at(-1)).some(b=>b.callback_data==='product:heart'));
 calls.length=0;shop.products.heart.active=false;await message('/all');assert.equal(sent().length,1);assert(inline(sent()[0]).some(b=>b.url===shop.store.support_url));
});
test('gallery works without a missing image and does not substitute a mockup for ready stock',async()=>{
 shop.store.mode='live';shop.store.sales_mode='ready';shop.env.PUBLIC_BASE_URL='https://shop.workers.dev';await message('/all');
 assert.equal(galleryImages().length,0);assert.equal(calls.filter(c=>c.method==='sendPhoto').length,0);assert.equal(inline(sent()[0]).filter(b=>b.callback_data?.startsWith('product:')).length,9);
});
test('gallery paginates above ten designs with stable numbering and no duplicate models',async()=>{
 shop.env.PUBLIC_BASE_URL='https://shop.workers.dev';for(let i=0;i<4;i++){const id='extra'+i;shop.products[id]={...shop.products.heart,id,name:'Модель '+i,photo:'https://owner.example.com/'+id+'.jpg'};}
 await message('/all');assert.equal(galleryImages().length,10);assert(inline(sent().at(-1)).some(b=>b.callback_data==='all:10'));
 const firstPage=galleryImages().map(m=>m.media);calls.length=0;await cb('all:10');assert.equal(galleryImages().length,3);assert(galleryImages().every(m=>!firstPage.includes(m.media)));
 assert(galleryImages()[0].caption.startsWith('11. '));assert(inline(sent().at(-1)).some(b=>b.callback_data==='all:0'));assert(!inline(sent().at(-1)).some(b=>b.text==='Показати ще'));
});
test('malformed gallery page numbers are rejected instead of producing a broken album',async()=>{
 for(const value of ['-1','1.5','NaN','999'])await assert.rejects(cb('all:'+value),ShopError);
 assert.equal(sent().length,0);
});
test('failed gallery requests keep product selection and the cart available',async()=>{
 shop.env.PUBLIC_BASE_URL='https://shop.workers.dev';await add();const fetchOk=globalThis.fetch;
 globalThis.fetch=async(url,options)=>String(url).endsWith('/sendMediaGroup')?Response.json({ok:false,error_code:400},{status:400}):fetchOk(url,options);
 await message('/all');const choices=sent().at(-1);assert(inline(choices).some(b=>b.callback_data==='all:0'));assert.equal(inline(choices).filter(b=>b.callback_data?.startsWith('product:')).length,9);assert.equal((await shop.cart(1))[0].quantity,1);
});
test('single-size cap can be added directly but unavailable stock cannot be ordered',async()=>{
 await cb('product:cap');const direct=inline(sent().at(-1)).find(b=>b.callback_data?.startsWith('add:cap:'));assert(direct);await cb(direct.callback_data);assert.equal((await shop.cart(1))[0].variant,'cap:black:ONE SIZE:');
 await run(db,'UPDATE stock SET quantity=0 WHERE variant=?',['cap:black:ONE SIZE:']);calls.length=0;await cb('product:cap');assert(!inline(sent().at(-1)).some(b=>b.callback_data?.startsWith('add:cap:')));assert(inline(sent().at(-1)).some(b=>b.callback_data==='unavailable'));
});
test('pair product requires two size selections and tells which size is being chosen',async()=>{
 await cb('color:pairtee:duo');assert(sent().at(-1).data.text.includes('першої'));assert(inline(sent().at(-1)).some(b=>b.callback_data==='first:pairtee:duo:S'));assert(!inline(sent().at(-1)).some(b=>b.callback_data?.startsWith('add2:')));
 await cb('first:pairtee:duo:S');assert(sent().at(-1).data.text.includes('Перша річ: S'));assert(sent().at(-1).data.text.includes('другої'));assert(inline(sent().at(-1)).some(b=>b.callback_data==='add2:pairtee:duo:S:XL'));
});
test('long custom product copy is kept outside Telegram media caption limits',async()=>{
 shop.env.PUBLIC_BASE_URL='https://shop.workers.dev';shop.products.heart.description='Тканина '.repeat(70);shop.products.heart.materials='Бавовна '.repeat(70);shop.products.heart.photo_confirmed=true;
 await cb('product:heart');const photo=sent().find(c=>c.method==='sendPhoto'),text=sent().find(c=>c.method==='sendMessage');assert(photo.data.caption.length<=1024);assert(text.data.text.includes(shop.products.heart.description));assert(text.data.text.length<=4096);assert(inline(text).some(b=>b.callback_data==='cart'));
});
test('checkout back works across phone, city, delivery and branch without losing the cart',async()=>{
 await add();await cb('checkout');await message('Олена Тестова');assert.equal((await shop.session(1)).step,'phone');await message('Назад');assert.equal((await shop.session(1)).step,'name');
 await message('Олена Тестова');await message('0671234567');await cb('checkout_back');assert.equal((await shop.session(1)).step,'phone');
 await message('0671234567');await message('Київ');await cb('delivery:locker');await cb('checkout_back');assert.equal((await shop.session(1)).step,'delivery');
 await cb('delivery:branch');assert(sent().at(-1).data.text.includes('відділення'));await message('12');await cb('checkout_back');assert.equal((await shop.session(1)).step,'branch');assert.equal((await shop.cart(1))[0].quantity,1);
});
test('duplicate checkout-back update cannot rewind two steps',async()=>{
 await add();await cb('checkout');await message('Олена Тестова');await message('0671234567');const bot=new Bot(shop,1,updateId++);
 await bot.checkoutBack();assert.equal((await shop.session(1)).step,'phone');await bot.checkoutBack();assert.equal((await shop.session(1)).step,'phone');
});
test('changing details after review invalidates the old confirmation button',async()=>{
 await add();await cb('checkout');await message('Олена Тестова');await message('0671234567');await message('Київ');await cb('delivery:branch');await message('12');await cb('package:standard');await cb('payment:cod');await cb('skipcomment');await cb('consent');
 const token=(await shop.session(1)).token;await cb('checkout_back');assert.equal((await shop.session(1)).step,'consent');await assert.rejects(cb('place:'+token),ShopError);
 await cb('consent');const replacement=(await shop.session(1)).token;assert.notEqual(replacement,token);await cb('place:'+replacement);assert.equal((await all(db,'SELECT * FROM orders')).length,1);
});
test('privacy and purchase terms stay accessible without sending a policy wall at checkout',async()=>{
 await new Bot(shop,1,updateId++).consentText();const prompt=sent()[0];assert(prompt.data.text.length<180);assert(inline(prompt).some(b=>b.callback_data==='info:privacy'));assert(inline(prompt).some(b=>b.callback_data==='info:terms'));
 calls.length=0;await cb('info:privacy');assert(sent()[0].data.text.includes('Ім’я, телефон'));assert(sent()[0].data.text.includes(shop.store.support_url));
});
test('help uses a short main menu and a separate secondary menu',async()=>{
 await message('Допомога');assert(sent()[0].data.text.length<100);assert(inline(sent()[0]).some(b=>b.callback_data==='info:more'));assert(!inline(sent()[0]).some(b=>b.callback_data==='info'));
 calls.length=0;await cb('info:more');for(const section of ['privacy','terms','care','packaging'])assert(inline(sent()[0]).some(b=>b.callback_data==='info:'+section));
});
test('copy upgrade replaces exact legacy drafts while preserving every custom owner value',async()=>{
 const store={...shop.store,delivery_text:STORE_COPY_UPDATES.delivery_text.previous[0],returns_text:'Мої погоджені умови повернення',support_url:'https://t.me/myshop',mode:'demo'};
 await run(db,"UPDATE settings SET value=? WHERE key='store'",[JSON.stringify(store)]);
 const heart={...shop.products.heart,description:PRODUCT_COPY_UPDATES.heart.previous};const lights={...shop.products.lights,description:'Авторський опис власника'};
 await run(db,'UPDATE products SET data=?,price=1350 WHERE id=?',[JSON.stringify(heart),'heart']);await run(db,'UPDATE products SET data=? WHERE id=?',[JSON.stringify(lights),'lights']);
 const loaded=await new Shop(env).load();assert.equal(loaded.store.delivery_text,STORE_COPY_UPDATES.delivery_text.value);assert.equal(loaded.store.returns_text,store.returns_text);assert.equal(loaded.store.support_url,store.support_url);assert.equal(loaded.products.heart.description,PRODUCT_COPY_UPDATES.heart.value);assert.equal(loaded.products.heart.price_uah,1350);assert.equal(loaded.products.lights.description,lights.description);
 assert.equal(JSON.parse((await first(db,"SELECT value FROM settings WHERE key='store'")).value).delivery_text,store.delivery_text);
});
test('owner menu is concise and admin help and export remain inaccessible to buyers',async()=>{
 await assert.rejects(cb('adminhelp:export'),ShopError);await assert.rejects(message('/admin'),ShopError);assert.equal(sent().length,0);
 await message('/admin',900);assert(sent()[0].data.text.length<100);assert(inline(sent()[0]).some(b=>b.callback_data==='adminhelp:photos'));
 calls.length=0;await cb('adminhelp:photos',900);assert(sent()[0].data.text.includes('\n'));assert(!sent()[0].data.text.includes('\\n'));assert(sent()[0].data.text.includes('/photo heart'));
});
test('gallery webhook is retry-safe and remains below the D1 free-plan query limit',async()=>{
 const update={update_id:99001,message:{from:{id:1},chat:{id:1,type:'private'},text:'Показати все'}};const secret=await webhookSecret(env);
 const request=()=>new Request('https://shop.workers.dev/telegram/webhook',{method:'POST',headers:{'X-Telegram-Bot-Api-Secret-Token':secret,'Content-Type':'application/json'},body:JSON.stringify(update)});
 db.queries=0;assert.equal((await worker.fetch(request(),env)).status,200);assert(db.queries<50);assert.equal(galleryImages().length,9);const count=sent().length;
 assert.equal((await worker.fetch(request(),env)).status,200);assert.equal(sent().length,count);
});
