import {esc,sha,first,run,epoch,onlineReady,send,btn,kb} from './core.js';

// Order numbers and item details belong in the owner's record, not status alerts.
export function buyerNotice(shop,o,topic='status'){
 const key=topic==='status'?o.status:topic;
 if(key==='new'&&o.status!=='new')return null; // A later milestone replaces a delayed acknowledgement.
 const texts={new:'Ваше замовлення отримали. Невдовзі напишемо, щоб погодити деталі.',confirmed:'Ваше замовлення підтверджено.',paid:'Оплату отримали. Дякуємо!',shipped:'Ваше замовлення вже в дорозі.\nТТН: <code>'+esc(o.tracking||'')+'</code>',completed:'Дякуємо за замовлення у FORMULOVE! Чекатимемо знову ♥\n\nВідмітьте нас у соцмережах і надішліть відмітку або скриншот — подаруємо 10% знижки на наступне замовлення.',cancelled:'Ваше замовлення скасовано.'};
 if(!texts[key])return null; // Preparing is an internal stage, with no extra ping.
 let text=texts[key];
 if(o.mode==='demo')text=key==='completed'?'Тестове замовлення завершено. Дякуємо за перевірку!':text+'\nТестове замовлення — без оплати.';
 if(key==='confirmed'&&o.mode==='live'&&o.customer.payment==='transfer')text+='\n\nРеквізити:\n'+esc(shop.store.bank_details)+'\nПризначення: оплата замовлення FORMULOVE.';
 const rows=key==='completed'?[[btn('Обрати ще','all:0')]]:[[btn('Ваше замовлення','order:'+o.id)]];
 if(key==='confirmed'&&o.mode==='live'&&onlineReady(shop.env))rows.unshift([btn('Оплатити карткою / гаманцем','pay:'+o.id)]);
 if(key==='completed'&&o.mode==='live'&&shop.store.support_url)rows.push([{text:'Надіслати відмітку',url:shop.store.support_url}]);
 return {key,text,markup:kb(...rows)};
}

// Claim a specific message before sending. Persistent receipts suppress retries,
// queued duplicate statuses and the manual bank check + webhook double alert.
export async function notifyBuyer(shop,o,topic='status'){
 const notice=buyerNotice(shop,o,topic);if(!notice)return 'skipped';
 const signature=await sha(notice.text),args=[o.id,notice.key,signature],now=epoch();
 const claimed=await first(shop.db,"INSERT INTO buyer_notifications(order_id,topic,signature,state,lock_until) VALUES(?,?,?,'sending',?) ON CONFLICT(order_id,topic,signature) DO UPDATE SET state='sending',lock_until=excluded.lock_until WHERE buyer_notifications.state!='done' AND buyer_notifications.lock_until<? RETURNING signature",[...args,now+90,now]);
 if(!claimed){const old=await first(shop.db,'SELECT state FROM buyer_notifications WHERE order_id=? AND topic=? AND signature=?',args);return old?.state==='done'?'done':'busy';}
 try{
  await send(shop.env,o.user_id,notice.text,notice.markup);
  await run(shop.db,"UPDATE buyer_notifications SET state='done',lock_until=0 WHERE order_id=? AND topic=? AND signature=?",args);
  return 'sent';
 }catch(error){await run(shop.db,"UPDATE buyer_notifications SET state='pending',lock_until=0 WHERE order_id=? AND topic=? AND signature=?",args);throw error;}
}
