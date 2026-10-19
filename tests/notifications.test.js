import {test,beforeEach,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {D1} from './d1.js';
import {Shop,ShopError,initialize,run,first,all,epoch,sha} from '../src/core.js';
import {Bot,drain,receipt} from '../src/bot.js';
import {verifyContact,recordReceipt} from '../src/commerce.js';
import {buyerNotice,notifyBuyer} from '../src/notifications.js';
import {invoice,syncInvoice} from '../src/payments.js';

let db,env,shop,calls,originalFetch,bank,update=90000;
beforeEach(async()=>{
 db=new D1();env={DB:db,BOT_TOKEN:'123456:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',SETUP_KEY:'test-key-012345678901234567890123456789',ADMIN_IDS:'900',PUBLIC_BASE_URL:'https://shop.example.com'};
 await initialize(db);shop=await new Shop(env).load();await verifyContact(shop,1,{user_id:1,phone_number:'0671234567',first_name:'Олена',last_name:'Тестова'});
 shop.store.mode='live';shop.store.catalog_confirmed=true;shop.store.terms_confirmed=true;calls=[];bank={status:'created'};originalFetch=globalThis.fetch;
 globalThis.fetch=async(url,options={})=>{const data=typeof options.body==='string'?JSON.parse(options.body):{},method=String(url).split('/').at(-1);calls.push({url:String(url),method,data});if(String(url).includes('api.monobank.ua')){if(String(url).endsWith('/invoice/create')){bank={...bank,invoiceId:'test_invoice',amount:data.amount,ccy:data.ccy,reference:data.merchantPaymInfo.reference};return Response.json({invoiceId:bank.invoiceId,pageUrl:'https://pay.mbnk.biz/test_invoice'});}return Response.json(bank);}return Response.json({ok:true,result:{message_id:calls.length}});};
});
afterEach(()=>{globalThis.fetch=originalFetch;db.close();});
const sent=(uid=1)=>calls.filter(c=>c.method==='sendMessage'&&c.data.chat_id===uid);
const buttons=c=>c.data.reply_markup?.inline_keyboard?.flat()||[];
const visible=c=>c.data.text+'\n'+buttons(c).map(b=>b.text).join('\n');
async function cb(data,uid=1){return new Bot(shop,uid,update++).handle({callback_query:{id:'q',from:{id:uid},data,message:{chat:{id:uid,type:'private'}}}});}
async function order(payment='cod'){
 await shop.changeCart(1,'heart:black:M:',1,'add:'+update++);const q=await shop.quote(1);
 return (await shop.place(1,'order:'+update++,{name:'Олена Тестова',phone:'+380671234567',city:'Київ',delivery:'branch',branch:'12',payment,package:'standard',consent:true},q.fingerprint)).order;
}
const flush=()=>drain(shop,30);
async function status(o,value){await shop.status(o.id,value,900);await flush();}
const online=()=>{Object.assign(env,{MONO_TOKEN:'test-merchant-token-0123456789',MONO_LIVE:'true'});Object.assign(shop.env,{MONO_TOKEN:env.MONO_TOKEN,MONO_LIVE:'true'});};
async function ship(o,tracking='20450000000000'){await shop.status(o.id,'shipped',900,{tracking});await flush();}
async function complete(o){await status(o,'confirmed');await ship(o);await status(o,'completed');}
function assertShort(c){const text=visible(c);assert(!text.includes('№'));assert(!text.includes(shop.products.heart.name));assert(!text.includes('Разом:'));assert(text.length<450);}

test('customer lifecycle has five short alerts with one payment, one tracking and one thank-you',async()=>{
 const o=await order();await flush();await status(o,'confirmed');await recordReceipt(shop,o.id,900,'payment:'+o.id);await flush();await status(o,'processing');await ship(o);await status(o,'completed');
 const messages=sent();assert.equal(messages.length,5);messages.forEach(assertShort);
 assert.match(messages[0].data.text,/Ваше замовлення отримали/);assert.equal(messages[1].data.text,'Ваше замовлення підтверджено.');assert.equal(messages[2].data.text,'Оплату отримали. Дякуємо!');
 assert.match(messages[3].data.text,/ТТН: <code>20450000000000<\/code>/);assert.match(messages[4].data.text,/Дякуємо за замовлення у FORMULOVE/);assert.match(messages[4].data.text,/10% знижки на наступне замовлення/);
 assert(buttons(messages[4]).some(b=>b.callback_data==='all:0'));assert(buttons(messages[4]).some(b=>b.url===shop.store.support_url));
 assert.equal((await all(db,"SELECT * FROM outbox WHERE state!='done'")).length,0);
});
test('owner retains internal number, buyer, delivery and full item record',async()=>{
 const o=await order();await flush();const text=sent(900)[0].data.text;assert(text.includes('№'+String(o.id).padStart(6,'0')));assert(text.includes(o.items[0].name));assert(text.includes('Олена Тестова'));assert(text.includes('+380671234567'));
 await cb('order:'+o.id,900);assert(sent(900).at(-1).data.text.includes('№'));assert(sent(900).at(-1).data.text.includes(o.items[0].name));
});
test('buyer list, summary, details and cancellation prompt never display the internal number',async()=>{
 const o=await order();await cb('orders');await cb('order:'+o.id);const summary=sent().at(-1);assert(summary.data.text.startsWith('<b>Ваше замовлення</b>'));assert(!summary.data.text.includes(o.items[0].name));assert(buttons(summary).some(b=>b.callback_data==='orderdetails:'+o.id));
 await cb('orderdetails:'+o.id);assert(sent().at(-1).data.text.includes(o.items[0].name));await cb('cancelask:'+o.id);
 sent().forEach(c=>assert(!visible(c).includes('№')));assert(!receipt(o,true).includes('№'));assert(receipt(o,true,true).includes('№'));
});
test('details callback keeps ownership checks even when phone registration is absent',async()=>{
 const o=await order();await assert.rejects(cb('orderdetails:'+o.id,2),ShopError);await run(db,'DELETE FROM customers WHERE user_id=1');await cb('orderdetails:'+o.id);assert(sent().at(-1).data.text.includes(o.items[0].name));
});
test('transfer confirmation contains necessary bank details once without an order number',async()=>{
 shop.store.bank_details='IBAN <bank> & FORMULOVE';shop.store.payment_methods=['cod','transfer'];const o=await order('transfer');await flush();calls.length=0;await status(o,'confirmed');
 assert.equal(sent().length,1);assertShort(sent()[0]);assert(sent()[0].data.text.includes('IBAN &lt;bank&gt; &amp; FORMULOVE'));assert(sent()[0].data.text.includes('Призначення: оплата замовлення FORMULOVE.'));
 await run(db,"INSERT INTO outbox(chat_id,order_id,kind) VALUES(1,?,'buyer_status')",[o.id]);await flush();assert.equal(sent().length,1);
});
test('rapid status changes coalesce into one current useful alert instead of repeated receipts',async()=>{
 const o=await order();await flush();calls.length=0;await shop.status(o.id,'confirmed',900);await recordReceipt(shop,o.id,900,'paid:'+o.id);await shop.status(o.id,'processing',900);await flush();
 assert.equal(sent().length,1);assert.equal(sent()[0].data.text,'Оплату отримали. Дякуємо!');
});
test('manual bank check and queued automatic payment alert send only one short message',async()=>{
 const o=await order();online();await status(o,'confirmed');await invoice(shop,o.id,1);calls.length=0;bank.status='success';await cb('paycheck:'+o.id);await flush();
 assert.equal(sent().length,1);assert.equal(sent()[0].data.text,'Оплату отримали. Дякуємо!');assertShort(sent()[0]);
});
test('checking an already acknowledged payment returns only a short answer without the receipt',async()=>{
 const o=await order();online();await status(o,'confirmed');await invoice(shop,o.id,1);bank.status='success';await cb('paycheck:'+o.id);await flush();calls.length=0;await cb('paycheck:'+o.id);await flush();
 assert.equal(sent().length,1);assert.equal(sent()[0].data.text,'Оплату вже підтверджено.');assertShort(sent()[0]);
});
test('unpaid bank check has one brief result and keeps the order accessible',async()=>{
 const o=await order();online();await status(o,'confirmed');await invoice(shop,o.id,1);calls.length=0;await cb('paycheck:'+o.id);
 assert.equal(sent().length,1);assert.equal(sent()[0].data.text,'Оплата ще не надійшла.');assertShort(sent()[0]);assert(buttons(sent()[0]).some(b=>b.callback_data==='order:'+o.id));
});
test('hosted payment destination does not expose the internal order number',async()=>{
 const o=await order();online();await status(o,'confirmed');await invoice(shop,o.id,1);const request=calls.find(c=>c.url.endsWith('/invoice/create')).data;assert.equal(request.merchantPaymInfo.destination,'Ваше замовлення FORMULOVE');assert.equal(request.amount,o.total*100);assert(request.merchantPaymInfo.reference);
});
test('bank recheck never rolls preparation back to paid or sends an extra payment alert',async()=>{
 const o=await order();online();await status(o,'confirmed');await invoice(shop,o.id,1);bank.status='success';await syncInvoice(shop,o.id);await flush();await status(o,'processing');calls.length=0;
 await run(db,'UPDATE payment_invoices SET checked_at=0');await syncInvoice(shop,o.id);await flush();assert.equal((await shop.order(o.id)).status,'processing');assert.equal(sent().length,0);
});
test('same tracking is not repeated but correcting tracking delivers the new number once',async()=>{
 const o=await order();await status(o,'confirmed');calls.length=0;await ship(o);await run(db,"INSERT INTO outbox(chat_id,order_id,kind) VALUES(1,?,'buyer_status')",[o.id]);await flush();assert.equal(sent().length,1);
 await run(db,'UPDATE orders SET tracking=? WHERE id=?',['20451111111111',o.id]);await run(db,"INSERT INTO outbox(chat_id,order_id,kind) VALUES(1,?,'buyer_status')",[o.id]);await flush();assert.equal(sent().length,2);assert(sent()[1].data.text.includes('20451111111111'));sent().forEach(assertShort);
});
test('failed Telegram delivery stays pending and retries without duplicating a successful alert',async()=>{
 const o=await order();const ok=globalThis.fetch;globalThis.fetch=async()=>Response.json({ok:false,error_code:429,parameters:{retry_after:10}},{status:429});await flush();
 assert.equal((await first(db,"SELECT state FROM buyer_notifications WHERE order_id=?",[o.id])).state,'pending');assert.equal((await all(db,"SELECT * FROM outbox WHERE state='pending'")).length,2);
 globalThis.fetch=ok;await run(db,'UPDATE outbox SET next_try=0');await flush();await flush();assert.equal(sent().length,1);assert.equal((await first(db,'SELECT state FROM buyer_notifications WHERE order_id=?',[o.id])).state,'done');
});
test('active delivery claim defers the queued duplicate and an expired claim is recovered',async()=>{
 const o=await order(),notice=buyerNotice(shop,o,'new'),signature=await sha(notice.text);await run(db,"INSERT INTO buyer_notifications(order_id,topic,signature,state,lock_until) VALUES(?,'new',?,'sending',?)",[o.id,signature,epoch()+90]);
 await flush();assert.equal(sent().length,0);assert.equal((await first(db,"SELECT state FROM outbox WHERE kind='buyer_new'")).state,'pending');
 await run(db,'UPDATE buyer_notifications SET lock_until=0');await run(db,'UPDATE outbox SET next_try=0');await flush();assert.equal(sent().length,1);
});
test('customer cancellation produces one short final alert without an immediate repeated card',async()=>{
 const o=await order();await flush();calls.length=0;await cb('canceldo:'+o.id);assert.equal(sent().length,0);await flush();assert.equal(sent().length,1);assert.equal(sent()[0].data.text,'Ваше замовлення скасовано.');assertShort(sent()[0]);
});
test('backlogged acknowledgements do not ask to agree details after completion',async()=>{
 const o=await order();await shop.status(o.id,'confirmed',900);await shop.status(o.id,'shipped',900,{tracking:'20450000000000'});await shop.status(o.id,'completed',900);await flush();
 assert.equal(sent().length,1);assert.match(sent()[0].data.text,/Дякуємо за замовлення/);assert(!sent()[0].data.text.includes('погодити деталі'));
});
test('thank-you deduplication is per order and demo does not promise a real discount',async()=>{
 const a=await order();await complete(a);const b=await order();await complete(b);assert.equal(sent().filter(c=>c.data.text.includes('10%')).length,2);
 const done=await shop.order(b.id);assert.equal(await notifyBuyer(shop,done),'done');calls.length=0;done.mode='demo';await notifyBuyer(shop,done);assert.equal(sent().length,1);assert(!sent()[0].data.text.includes('10%'));assert(sent()[0].data.text.includes('Тестове замовлення'));
});
test('v1 migration adds the notification journal while retaining existing orders and prices',async()=>{
 const o=await order();await run(db,'DROP TABLE buyer_notifications');await run(db,"UPDATE settings SET value='1' WHERE key='commerce_schema'");await run(db,"UPDATE products SET price=1390 WHERE id='heart'");
 const loaded=await new Shop(env).load();assert.equal((await loaded.order(o.id)).total,o.total);assert.equal(loaded.products.heart.price_uah,1390);assert.equal((await first(db,"SELECT value FROM settings WHERE key='commerce_schema'")).value,'2');assert.deepEqual(await all(db,'SELECT * FROM buyer_notifications'),[]);await drain(loaded);assert.equal(sent().length,1);
});
