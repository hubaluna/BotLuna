import {ShopError,onlineReady,first,all,run,stmt,stamp,epoch,sha,randomToken} from './core.js';
import {balances} from './commerce.js';
export const monoHook=env=>sha('FORMULOVE:mono:'+env.SETUP_KEY);
async function mono(env,path,body){
 let response,data;try{response=await fetch('https://api.monobank.ua'+path,{method:body?'POST':'GET',headers:{'X-Token':env.MONO_TOKEN,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000)});data=await response.json();}catch{throw new ShopError('Платіжний сервіс тимчасово недоступний. Не сплачуйте повторно; перевірте замовлення пізніше.');}
 if(!response.ok)throw new ShopError('Не вдалося отримати відповідь платіжного сервісу. Зверніться до нас.');return data;
}
export async function invoice(shop,id,uid){
 if(!onlineReady(shop.env)||shop.store.mode!=='live')throw new ShopError('Онлайн-оплата ще не підключена. Оберіть інший спосіб або напишіть нам.');
 const o=await shop.order(id);if(!o||o.user_id!==uid||o.mode!=='live')throw new ShopError('Замовлення не знайдено.');
 if(!['confirmed','processing'].includes(o.status))throw new ShopError('Посилання на оплату буде доступне після погодження замовлення.');
 const b=await balances(shop,id);if(b.received)throw new ShopError('За замовленням уже записано оплату. Не сплачуйте повторно.');
 let row=await first(shop.db,'SELECT * FROM payment_invoices WHERE order_id=?',[id]);if(row?.page_url&&['created','processing','hold'].includes(row.state))return row;
 if(row)throw new ShopError('Рахунок уже створювався. Перевірте оплату або напишіть нам; новий рахунок автоматично не створюється.');
 const reference='FORMULOVE-'+id+'-'+randomToken();const claim=await run(shop.db,"INSERT OR IGNORE INTO payment_invoices(order_id,amount,created_at,reference) VALUES(?,?,?,?)",[id,o.total*100,stamp(),reference]);if(!claim.meta.changes)throw new ShopError('Рахунок уже готується. Відкрийте замовлення ще раз.');
 const base=new URL(shop.env.PUBLIC_BASE_URL).origin;
 const data=await mono(shop.env,'/api/merchant/invoice/create',{amount:o.total*100,ccy:980,merchantPaymInfo:{reference,destination:'Ваше замовлення FORMULOVE'},redirectUrl:base+'/payment-return',webHookUrl:base+'/payments/mono/'+await monoHook(shop.env),validity:86400,paymentType:'debit'});
 let url;try{url=new URL(data.pageUrl);}catch{throw new ShopError('Платіжний сервіс повернув некоректне посилання. Напишіть нам.');}
 if(url.protocol!=='https:'||!['pay.mbnk.biz','pay.monobank.ua'].includes(url.hostname)||!/^[-\w]{1,80}$/.test(data.invoiceId||''))throw new ShopError('Не вдалося перевірити посилання на оплату. Напишіть нам.');
 await run(shop.db,"UPDATE payment_invoices SET invoice_id=?,page_url=?,state='created' WHERE order_id=?",[data.invoiceId,url.href,id]);await run(shop.db,"UPDATE orders SET customer=json_set(customer,'$.payment','card') WHERE id=?",[id]);return first(shop.db,'SELECT * FROM payment_invoices WHERE order_id=?',[id]);
}
export async function syncInvoice(shop,id){
 if(!onlineReady(shop.env))throw new ShopError('Онлайн-оплата не налаштована.');const row=await first(shop.db,'SELECT * FROM payment_invoices WHERE order_id=?',[id]);if(!row?.invoice_id)throw new ShopError('Для цього замовлення немає платіжного рахунку.');
 const claim=await run(shop.db,'UPDATE payment_invoices SET checked_at=? WHERE order_id=? AND checked_at<?',[epoch(),id,epoch()-5]);if(!claim.meta.changes)return row.state;
 const data=await mono(shop.env,'/api/merchant/invoice/status?invoiceId='+encodeURIComponent(row.invoice_id));
 if(data.invoiceId!==row.invoice_id||data.amount!==row.amount||data.ccy!==980||data.reference!==row.reference)throw new ShopError('Дані оплати не збігаються із замовленням. Напишіть нам.');
 const allowed=['created','processing','hold','success','failure','reversed','expired'];if(!allowed.includes(data.status))throw new ShopError('Невідомий статус оплати. Зверніться до нас.');
 const tasks=[stmt(shop.db,'UPDATE payment_invoices SET state=? WHERE order_id=?',[data.status,id])];
 if(['success','reversed'].includes(data.status)){
  tasks.push(stmt(shop.db,"INSERT OR IGNORE INTO order_money(order_id,kind,amount,reference,source,created_at) VALUES(?,'receipt',?,?,'monobank',?)",[id,row.amount,'mono:'+row.invoice_id,stamp()]));
  if(data.status==='success')tasks.push(stmt(shop.db,"UPDATE orders SET status='paid' WHERE id=? AND (status='confirmed' OR (status='processing' AND NOT EXISTS(SELECT 1 FROM events WHERE order_id=? AND status='paid')))",[id,id]));
 }
 if(data.status==='success')for(const c of data.cancelList||[]){if(c.status!=='success')continue;if(!Number.isSafeInteger(c.amount)||c.amount<=0||c.ccy!==980||typeof c.extRef!=='string'||!c.extRef||c.extRef.length>100)throw new ShopError('Перевірте повернення в кабінеті банку.');tasks.push(stmt(shop.db,"INSERT OR IGNORE INTO order_money(order_id,kind,amount,reference,source,created_at) VALUES(?,'refund',?,?,'monobank',?)",[id,c.amount,'mono-refund:'+row.invoice_id+':'+c.extRef,stamp()]));}
 // The bank status is verified independently; an order cancellation never implies a cash refund.
 if(data.status==='reversed')tasks.push(stmt(shop.db,"INSERT OR IGNORE INTO order_money(order_id,kind,amount,reference,source,created_at) SELECT ?,'refund',SUM(CASE WHEN kind='receipt' THEN amount ELSE -amount END),?,'monobank',? FROM order_money WHERE order_id=? HAVING SUM(CASE WHEN kind='receipt' THEN amount ELSE -amount END)>0",[id,'mono-reversal:'+row.invoice_id,stamp(),id]));
 await shop.db.batch(tasks);return data.status;
}
export async function pollPayments(shop,limit=1){
 if(!onlineReady(shop.env))return;const rows=await all(shop.db,"SELECT order_id FROM payment_invoices WHERE invoice_id IS NOT NULL AND state IN('created','processing','hold') ORDER BY checked_at LIMIT ?",[limit]);for(const r of rows)try{await syncInvoice(shop,r.order_id);}catch{}
}
