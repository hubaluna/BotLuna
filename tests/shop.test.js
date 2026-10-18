import {test,beforeEach,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {D1} from './d1.js';
import {Shop,initialize,run,first,all,phone,ShopError,money} from '../src/core.js';
import {Bot,drain,receipt} from '../src/bot.js';
import worker,{webhookSecret} from '../src/worker.js';

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
test('button callback lengths and message lengths match Telegram limits',async()=>{for(const p of Object.values(shop.products)){await new Bot(shop,1,updateId++).product(p.id);for(const c of p.colors)await new Bot(shop,1,updateId++).sizes(p.id,c.id,p.pair?p.sizes[0]:'');}for(const c of calls){if(c.method!=='sendMessage')continue;assert(c.data.text.length<=4096);for(const row of c.data.reply_markup?.inline_keyboard||[])for(const b of row)if(b.callback_data)assert(Buffer.byteLength(b.callback_data)<=64);}});


test('tee cards use clean product captions and keep made-to-order information',async()=>{
 env.PUBLIC_BASE_URL='https://my-store.workers.dev';shop.env.PUBLIC_BASE_URL=env.PUBLIC_BASE_URL;
 for(const id of ['heart','lights','speed'])await new Bot(shop,1,updateId++).product(id);
 const photos=calls.filter(c=>c.method==='sendPhoto');assert.equal(photos.length,3);
 assert.deepEqual(photos.map(c=>c.data.photo),['heart','lights','speed'].map(id=>'https://my-store.workers.dev/products/'+id+'-concept-v1.jpg'));
 for(const c of photos){assert(!c.data.caption.includes('Візуалізація'));assert(c.data.caption.split('\n').length<=2);}assert(calls.some(c=>c.method==='sendMessage'&&c.data.text.includes('Виготовлення під замовлення.')));
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
 const photos=calls.filter(c=>c.method==='sendPhoto');assert.equal(photos.length,9);for(const p of photos)assert(!p.data.caption.includes('Візуалізація'));assert.equal(calls.filter(c=>c.method==='sendMessage'&&c.data.text.includes('Виготовлення під замовлення.')).length,9);
});
test('stored preorder conditions remain visible after later catalogue changes',async()=>{
 const o=await place();shop.store.sales_mode='ready';
 const saved=await shop.order(o.id);assert.equal(saved.customer.sale_type,'preorder');assert.match(receipt(saved),/строк відправлення/);
});


test('live storefront avoids technical image notices and confirms fulfillment before ordering',async()=>{
 shop.store.mode='live';shop.store.catalog_confirmed=true;shop.store.terms_confirmed=true;shop.env.PUBLIC_BASE_URL='https://shop.workers.dev';
 await new Bot(shop,1,updateId++).home();await new Bot(shop,1,updateId++).product('heart');
 const messages=calls.filter(c=>c.method==='sendMessage').map(c=>c.data.text).join('\n');
 for(const term of ['Візуалізація','не фото','Демонстраційний','зразок ще не затверджено'])assert(!messages.includes(term));
 assert(messages.includes('Виготовлення під замовлення.'));assert(!messages.includes('є в наявності'));
 await add();const order=await place(1,'polished-copy');const text=receipt(order);assert(text.includes('до оплати'));assert(!text.includes('Візуалізація'));
});
