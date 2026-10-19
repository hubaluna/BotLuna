import {ShopError,phone,stamp,epoch,first,all,run,stmt,send,esc,kb,btn,adminIds} from './core.js';

export async function profile(shop,uid){return first(shop.db,'SELECT * FROM customers WHERE user_id=?',[uid]);}
export async function verifyContact(shop,uid,contact){
 if(!contact||contact.user_id!==uid)throw new ShopError('Натисніть «Поділитися номером». Контакт має належати вашому Telegram-акаунту.');
 const number=phone(contact.phone_number),now=stamp(),name=[contact.first_name,contact.last_name].filter(Boolean).join(' ').slice(0,100);
 await shop.db.batch([stmt(shop.db,"INSERT INTO customers(user_id,phone,full_name,verified_at,created_at,last_seen) VALUES(?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET phone=excluded.phone,verified_at=excluded.verified_at,last_seen=excluded.last_seen,blocked=0",[uid,number,name,now,now,now]),stmt(shop.db,"INSERT INTO consent_events(user_id,topic,accepted,created_at) VALUES(?,'account_phone',1,?)",[uid,now])]);
 return profile(shop,uid);
}
export async function marketing(shop,uid,accepted){
 const p=await profile(shop,uid);if(!p?.verified_at)throw new ShopError('Спершу підтвердіть свій номер: /start.');const now=stamp();
 await shop.db.batch([stmt(shop.db,'UPDATE customers SET marketing=?,marketing_at=? WHERE user_id=?',[accepted?1:0,now,uid]),stmt(shop.db,"INSERT INTO consent_events(user_id,topic,accepted,created_at) VALUES(?,'news',?,?)",[uid,accepted?1:0,now])]);
}
export const pennies=value=>{const n=Number(value);if(!Number.isFinite(n)||n<=0||n>10000000||Math.abs(n*100-Math.round(n*100))>0.00001)throw new ShopError('Вкажіть суму в гривнях, до двох знаків після коми.');return Math.round(n*100);};
export const cash=value=>(Number(value||0)/100).toLocaleString('uk-UA',{maximumFractionDigits:2})+' грн';
export async function balances(shop,id){return first(shop.db,"SELECT COALESCE(SUM(CASE WHEN kind='receipt' THEN amount ELSE 0 END),0) received,COALESCE(SUM(CASE WHEN kind='refund' THEN amount ELSE 0 END),0) refunded FROM order_money WHERE order_id=?",[id]);}
export async function recordReceipt(shop,id,actor,reference){
 if(!adminIds(shop.env).includes(actor))throw new ShopError('Немає доступу.');const o=await shop.order(id);if(!o||['new','cancelled'].includes(o.status))throw new ShopError('Спершу погодьте замовлення.');
 const invoice=await first(shop.db,'SELECT state,invoice_id FROM payment_invoices WHERE order_id=?',[id]);if(invoice?.invoice_id&&!['failure','expired','reversed'].includes(invoice.state))throw new ShopError('Є рахунок monobank. Спершу перевірте його оплату; не дублюйте надходження вручну.');
 const b=await balances(shop,id),amount=o.total*100-b.received;if(amount<=0)return;
 await shop.db.batch([stmt(shop.db,"INSERT OR IGNORE INTO order_money(order_id,kind,amount,reference,source,created_at) SELECT ?,'receipt',?,?,?,? WHERE (SELECT COALESCE(SUM(amount),0) FROM order_money WHERE order_id=? AND kind='receipt')<?",[id,amount,reference,'manual',stamp(),id,o.total*100]),stmt(shop.db,"UPDATE orders SET status='paid' WHERE id=? AND status IN('confirmed','processing')",[id])]);
}
export async function recordRefund(shop,id,amount,reference){
 const o=await shop.order(id);if(!o)throw new ShopError('Замовлення не знайдено.');if(!Number.isSafeInteger(amount)||amount<=0)throw new ShopError('Перевірте суму повернення.');
 const invoice=await first(shop.db,'SELECT invoice_id,state FROM payment_invoices WHERE order_id=?',[id]);if(invoice?.invoice_id&&!['failure','expired'].includes(invoice.state))throw new ShopError('Для monobank натисніть «Перевірити оплату». Повернення звіряються з банком.');
 const b=await balances(shop,id);if(await first(shop.db,'SELECT id FROM order_money WHERE reference=?',[reference]))return;
 if(amount>b.received-b.refunded)throw new ShopError('Повернення перевищує отриману суму.');
 await run(shop.db,"INSERT INTO order_money(order_id,kind,amount,reference,source,created_at) VALUES(?,'refund',?,?,'manual',?)",[id,amount,reference,stamp()]);
}
export async function expense(shop,{amount,category,note,reference}){
 if(!['production','ads','shipping','fees','tax','other'].includes(category)||typeof note!=='string'||note.length>300||!Number.isSafeInteger(amount)||amount<=0||typeof reference!=='string'||reference.length<8||reference.length>100)throw new ShopError('Перевірте суму, категорію та опис витрати.');
 await run(shop.db,'INSERT OR IGNORE INTO expenses(mode,amount,category,note,created_at,reference) VALUES(?,?,?,?,?,?)',[shop.store.mode,amount,category,note,stamp(),reference]);
}
export function reportingRange(input={}){
 const to=input.to||stamp().slice(0,10),from=input.from||new Date(Date.now()-29*86400000).toISOString().slice(0,10);
 for(const s of [from,to])if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||Number.isNaN(Date.parse(s))||new Date(s).toISOString().slice(0,10)!==s)throw new ShopError('Дата: РРРР-ММ-ДД.');
 if(from>to||(Date.parse(to)-Date.parse(from))/86400000>366)throw new ShopError('Оберіть період до 367 днів.');
 return {from,to,start:from+'T00:00:00.000Z',end:new Date(Date.parse(to)+86400000).toISOString()};
}
export async function analytics(shop,input={}){
 const range=reportingRange(input),args=[range.start,range.end];
 const [summary,statuses,daily,products,moneyRows,expensesRows,audience,orders]=await Promise.all([
 first(shop.db,"SELECT COUNT(*) orders,COALESCE(SUM(CASE WHEN status!='cancelled' THEN total ELSE 0 END),0) ordered_uah,COALESCE(SUM(status='cancelled'),0) cancelled,COUNT(DISTINCT CASE WHEN status!='cancelled' THEN user_id END) buyers FROM orders WHERE mode='live' AND created_at>=? AND created_at<?",args),
 all(shop.db,"SELECT status,COUNT(*) count FROM orders WHERE mode='live' AND created_at>=? AND created_at<? GROUP BY status",args),
 all(shop.db,"SELECT substr(created_at,1,10) day,COUNT(*) orders,SUM(total) total_uah FROM orders WHERE mode='live' AND status!='cancelled' AND created_at>=? AND created_at<? GROUP BY day ORDER BY day",args),
 all(shop.db,"SELECT json_extract(j.value,'$.product_id') product_id,json_extract(j.value,'$.name') name,SUM(json_extract(j.value,'$.quantity')) quantity,SUM(json_extract(j.value,'$.quantity')*json_extract(j.value,'$.unit_price')) total_uah FROM orders o,json_each(o.items) j WHERE o.mode='live' AND o.status!='cancelled' AND o.created_at>=? AND o.created_at<? GROUP BY product_id ORDER BY total_uah DESC LIMIT 20",args),
 all(shop.db,"SELECT m.kind,SUM(m.amount) amount FROM order_money m JOIN orders o ON o.id=m.order_id WHERE o.mode='live' AND m.created_at>=? AND m.created_at<? GROUP BY m.kind",args),
 all(shop.db,"SELECT category,SUM(amount) amount FROM expenses WHERE mode='live' AND created_at>=? AND created_at<? GROUP BY category",args),
 first(shop.db,"SELECT COUNT(*) profiles,SUM(verified_at!='') verified,SUM(marketing=1 AND blocked=0) subscribers FROM customers"),
 all(shop.db,"SELECT o.id,o.created_at,o.status,o.total,o.tracking,o.customer,(SELECT COALESCE(SUM(CASE WHEN kind='receipt' THEN amount ELSE -amount END),0) FROM order_money WHERE order_id=o.id) paid_kopecks FROM orders o WHERE o.mode='live' AND o.created_at>=? AND o.created_at<? ORDER BY o.id DESC LIMIT 100",args)
 ]);
 const received=moneyRows.find(r=>r.kind==='receipt')?.amount||0,refunded=moneyRows.find(r=>r.kind==='refund')?.amount||0,spent=expensesRows.reduce((s,r)=>s+r.amount,0);
 const repeat=await first(shop.db,"SELECT COUNT(*) count FROM (SELECT DISTINCT o.user_id FROM orders o WHERE o.mode='live' AND o.status!='cancelled' AND o.created_at>=? AND o.created_at<? AND (SELECT COUNT(*) FROM orders p WHERE p.user_id=o.user_id AND p.mode='live' AND p.status!='cancelled' AND p.id<=o.id)>1)",args);
 return {range,summary:{...summary,average_order_uah:summary.orders-summary.cancelled?Math.round(summary.ordered_uah/(summary.orders-summary.cancelled)):0,received_kopecks:received,refunded_kopecks:refunded,expenses_kopecks:spent,recorded_cash_difference:received-refunded-spent,repeat_buyers:repeat.count},statuses,daily,products,expenses:expensesRows,audience,orders:orders.map(o=>({...o,customer:JSON.parse(o.customer)})),notes:['Тільки live. Дати у UTC. Сума замовлень рахується за датою створення; оплати, повернення й витрати — за датою запису.','Надходження показані до банківських комісій. Комісії та інші витрати внесіть окремо. Різниця надходжень і внесених витрат не дорівнює чистому прибутку.','Статус «Відправлено» не означає оплату. Скасування не записує повернення грошей. Оплати до появи журналу можуть потребувати внесення вручну.']};
}
export function csvTable(rows){const cell=v=>{let s=String(v??'');if(/^\s*[=+\-@]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};return '\ufeff'+rows.map(row=>row.map(cell).join(',')).join('\r\n');}
export async function accountingCSV(shop,type,input={}){
 const range=reportingRange(input),args=[range.start,range.end];let table;
 if(type==='orders'||type==='items'){
  const orders=await all(shop.db,"SELECT * FROM orders WHERE mode='live' AND created_at>=? AND created_at<? ORDER BY id LIMIT 10001",args);
  table=type==='orders'?[['Номер','Дата UTC','Статус','Сума грн','Покупець Telegram ID','Номер покупця','Одержувач','Телефон одержувача','Місто','Доставка','Відділення','Оплата','ТТН']]:[['Замовлення','Дата UTC','ID товару','Товар','Варіант','Кількість одиниць або комплектів','Ціна грн','Сума грн']];
  if(orders.length>10000)throw new ShopError('У звіті понад 10 000 записів. Зменшіть період.');
  for(const o of orders){const c=JSON.parse(o.customer);if(type==='orders')table.push([o.id,o.created_at,o.status,o.total,o.user_id,c.buyer_phone||'',c.name,c.phone,c.city,c.delivery,c.branch,c.payment,o.tracking]);else for(const i of JSON.parse(o.items))table.push([o.id,o.created_at,i.product_id,i.name,i.label,i.quantity,i.unit_price,i.quantity*i.unit_price]);}
 }else if(type==='money'){const rows=await all(shop.db,"SELECT m.* FROM order_money m JOIN orders o ON o.id=m.order_id WHERE o.mode='live' AND m.created_at>=? AND m.created_at<? ORDER BY m.id LIMIT 10001",args);if(rows.length>10000)throw new ShopError('Зменшіть період звіту.');table=[['Запис','Замовлення','Дата UTC','Тип','Сума грн','Джерело','Посилання операції'],...rows.map(r=>[r.id,r.order_id,r.created_at,r.kind,r.amount/100,r.source,r.reference])];}
 else if(type==='expenses'){const rows=await all(shop.db,"SELECT * FROM expenses WHERE mode='live' AND created_at>=? AND created_at<? ORDER BY id LIMIT 10001",args);if(rows.length>10000)throw new ShopError('Зменшіть період звіту.');table=[['Запис','Дата UTC','Категорія','Сума грн','Опис'],...rows.map(r=>[r.id,r.created_at,r.category,r.amount/100,r.note])];}
 else throw new ShopError('Невідомий звіт.');
 if(table.length>10001)throw new ShopError('У звіті понад 10 000 рядків. Зменшіть період.');return csvTable(table);
}
export async function draftCampaign(shop,text,actor){if(!adminIds(shop.env).includes(actor)||typeof text!=='string'||text.trim().length<3||text.length>2500)throw new ShopError('Текст новини: 3–2500 символів.');const r=await run(shop.db,"INSERT INTO campaigns(text,created_at,actor) VALUES(?,?,?)",[text.trim(),stamp(),actor]);return r.meta.last_row_id;}
export async function queueCampaign(shop,id,actor){
 if(!adminIds(shop.env).includes(actor))throw new ShopError('Немає доступу.');const c=await first(shop.db,"SELECT * FROM campaigns WHERE id=? AND state='draft'",[id]);if(!c)return;
 await shop.db.batch([stmt(shop.db,"INSERT OR IGNORE INTO campaign_deliveries(campaign_id,user_id) SELECT ?,user_id FROM customers WHERE marketing=1 AND blocked=0 AND verified_at!=''",[id]),stmt(shop.db,"UPDATE campaigns SET state='queued' WHERE id=? AND state='draft'",[id])]);
}
export async function drainCampaigns(shop,limit=3){
 const rows=await all(shop.db,"SELECT d.campaign_id,d.user_id,c.text,u.marketing,u.blocked FROM campaign_deliveries d JOIN campaigns c ON c.id=d.campaign_id JOIN customers u ON u.user_id=d.user_id WHERE c.state='queued' AND ((d.state='pending' AND d.next_try<=?) OR (d.state='sending' AND d.lock_until<?)) LIMIT ?",[epoch(),epoch(),limit]);
 for(const r of rows){const claim=await first(shop.db,"UPDATE campaign_deliveries SET state='sending',lock_until=? WHERE campaign_id=? AND user_id=? AND (state='pending' OR (state='sending' AND lock_until<?)) AND EXISTS(SELECT 1 FROM campaigns WHERE id=campaign_deliveries.campaign_id AND state='queued') RETURNING (SELECT marketing FROM customers WHERE user_id=campaign_deliveries.user_id) marketing,(SELECT blocked FROM customers WHERE user_id=campaign_deliveries.user_id) blocked",[epoch()+90,r.campaign_id,r.user_id,epoch()]);if(!claim)continue;
  if(!claim.marketing||claim.blocked){await run(shop.db,"UPDATE campaign_deliveries SET state='skipped' WHERE campaign_id=? AND user_id=?",[r.campaign_id,r.user_id]);continue;}
  try{await send(shop.env,r.user_id,esc(r.text)+'\n\nВідписатися: /unsubscribe',kb([btn('Не отримувати новини','news:off')]));await run(shop.db,"UPDATE campaign_deliveries SET state='done',lock_until=0 WHERE campaign_id=? AND user_id=?",[r.campaign_id,r.user_id]);}
  catch(e){if(e.code===403){await shop.db.batch([stmt(shop.db,'UPDATE customers SET blocked=1 WHERE user_id=?',[r.user_id]),stmt(shop.db,"UPDATE campaign_deliveries SET state='skipped' WHERE campaign_id=? AND user_id=?",[r.campaign_id,r.user_id])]);}else await run(shop.db,"UPDATE campaign_deliveries SET state=CASE WHEN EXISTS(SELECT 1 FROM campaigns WHERE id=campaign_deliveries.campaign_id AND state='queued') THEN 'pending' ELSE 'skipped' END,attempts=attempts+1,next_try=?,lock_until=0 WHERE campaign_id=? AND user_id=?",[epoch()+Math.max(60,e.retry||0),r.campaign_id,r.user_id]);}
 }
 await run(shop.db,"UPDATE campaigns SET state='done' WHERE state='queued' AND NOT EXISTS(SELECT 1 FROM campaign_deliveries d WHERE d.campaign_id=campaigns.id AND d.state IN('pending','sending'))");
}
