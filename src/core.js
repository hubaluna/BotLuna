import { customerStoreCopy,customerProductCopy } from './copy.js';
import { DEFAULT_CATALOG, DEFAULT_STORE } from './defaults.js';
import { SCHEMA,ensureCommerce } from './schema.js';

export const STATUS={new:'Очікує підтвердження',confirmed:'Підтверджено',paid:'Оплату підтверджено',processing:'Готуємо',shipped:'Відправлено',completed:'Завершено',cancelled:'Скасовано'};
export const NEXT={new:['confirmed','cancelled'],confirmed:['paid','processing','shipped','cancelled'],paid:['processing','shipped','cancelled'],processing:['paid','shipped','cancelled'],shipped:['completed'],completed:[],cancelled:[]};
export const DELIVERY={branch:'Відділення Нової пошти',locker:'Поштомат Нової пошти'};
export const PAYMENTS={cod:'Післяплата',transfer:'Переказ на рахунок',card:'Картка · Apple Pay · Google Pay'};
export const CONCEPT_PHOTOS={heart:{color:'Чорний',file:'heart-concept-v1.jpg'},lights:{color:'Молочний',file:'lights-concept-v1.jpg'},speed:{color:'Чорний',file:'speed-concept-v1.jpg'},cap:{color:'Чорний',file:'cap-concept-v1.jpg'},sweat:{color:'Молочний',file:'sweat-concept-v1.jpg'},hoodie:{color:'Чорний',file:'hoodie-concept-v1.jpg'},zip:{color:'Графіт',file:'zip-concept-v1.jpg'},pairtee:{color:'Чорний + молочний',file:'pairtee-concept-v1.jpg'},pairsweat:{color:'Чорний + молочний',file:'pairsweat-concept-v1.jpg'}};
export const PREORDER_NOTICE='Виготовлення під замовлення. Розмір, матеріали, остаточну вартість і строк відправлення погодимо з вами до оплати.';
export const onlineReady=env=>typeof env.MONO_TOKEN==='string'&&env.MONO_TOKEN.length>=20&&env.MONO_LIVE==='true';
export class ShopError extends Error {}
export const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const money=n=>String(n).replace(/\B(?=(\d{3})+(?!\d))/g,' ')+' грн';
export const stamp=()=>new Date().toISOString();
export const epoch=()=>Math.floor(Date.now()/1000);
export const randomToken=()=>crypto.randomUUID().replaceAll('-','');
export async function sha(s){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))].map(x=>x.toString(16).padStart(2,'0')).join('');}
export function phone(raw){let v=String(raw).trim().replace(/[\s()+-]/g,'');if(/^0\d{9}$/.test(v))v='38'+v;if(!/^380\d{9}$/.test(v))throw new ShopError('Вкажіть телефон у форматі +380XXXXXXXXX або 0XXXXXXXXX.');return '+'+v;}
export function adminIds(env){return [...new Set(String(env.ADMIN_IDS||'').split(',').map(x=>x.trim()).filter(Boolean).map(Number).filter(x=>Number.isSafeInteger(x)&&x>0))];}
export function targets(env){const group=Number(env.ADMIN_CHAT_ID||0);return Number.isSafeInteger(group)&&group!==0?[group]:adminIds(env);}
export const stmt=(db,sql,args=[])=>db.prepare(sql).bind(...args);
export async function first(db,sql,args=[]){return stmt(db,sql,args).first();}
export async function all(db,sql,args=[]){const r=await stmt(db,sql,args).all();return r.results||[];}
export async function run(db,sql,args=[]){return stmt(db,sql,args).run();}
export function publicError(error){const s=String(error?.message||'');if(/STOCK_CHANGED/.test(s))return 'Наявність змінилася. Оновіть кошик або оберіть інший варіант.';if(/CART_LIMIT/.test(s))return 'Кошик завеликий. Для оптового замовлення зверніться до менеджера.';if(/PRICE_CHANGED|CART_CHANGED|CONFIG_CHANGED/.test(s))return 'Ціна, кошик або умови змінилися. Перегляньте замовлення ще раз.';return error instanceof ShopError?s:'Не вдалося виконати дію. Спробуйте ще раз.';}

export function validateCatalog(catalog){
 if(catalog.currency!=='UAH'||!Array.isArray(catalog.products)||!Array.isArray(catalog.categories)||catalog.products.length>100)throw new ShopError('Перевірте структуру каталогу.');
 const ids=new Set(),cats=new Set(catalog.categories.map(c=>c.id));
 for(const p of catalog.products){
  if(!/^[a-z0-9]{1,16}$/.test(p.id)||ids.has(p.id))throw new ShopError('ID товарів мають бути унікальними: малі латинські літери та цифри.');ids.add(p.id);
  if(!cats.has(p.category)||!Number.isInteger(p.price_uah)||p.price_uah<1||p.price_uah>100000||typeof p.active!=='boolean')throw new ShopError('Перевірте категорію, ціну та active товару '+p.id);
  if(typeof p.pair!=='boolean'||!Array.isArray(p.colors)||!p.colors.length||p.colors.length>10||!Array.isArray(p.sizes)||!p.sizes.length||p.sizes.length>15)throw new ShopError('Перевірте варіанти '+p.id);
  if(new Set(p.colors.map(c=>c.id)).size!==p.colors.length||new Set(p.sizes).size!==p.sizes.length||p.colors.some(c=>!/^[a-z0-9]{1,12}$/.test(c.id))||p.sizes.some(s=>!/^[A-Z0-9 ]{1,10}$/.test(s)))throw new ShopError('Некоректні або повторні кольори/розміри '+p.id);
  if(!Number.isInteger(p.initial_stock)||p.initial_stock< -1||p.initial_stock>100000)throw new ShopError('initial_stock: -1 або невід’ємне ціле число.');
  for(const key of ['name','description','materials','fit','embroidery'])if(typeof p[key]!=='string'||!p[key]||p[key].length>600)throw new ShopError('Поле '+key+' товару '+p.id+' має містити 1–600 символів.');
  if(!Array.isArray(p.measurements)||p.measurements.some(x=>typeof x!=='string'||x.length>200)||p.measurements.length>20)throw new ShopError('Перевірте заміри '+p.id);
  if(p.photo&&(!/^https:\/\//.test(p.photo)||p.photo.length>500))throw new ShopError('Фото: HTTPS-посилання або завантаження через Telegram.');
 }
}
export function validateStore(s){
 if(s.sales_mode!==undefined&&!['preorder','ready'].includes(s.sales_mode))throw new ShopError('Оберіть передзамовлення або готові товари.');
 if(s.card_enabled!==undefined&&typeof s.card_enabled!=='boolean')throw new ShopError('Перевірте перемикач онлайн-оплати.');
 if(s.admin_ids!==undefined&&(typeof s.admin_ids!=='string'||s.admin_ids.length>250||(s.admin_ids&&!/^\d+(?:\s*,\s*\d+)*$/.test(s.admin_ids))))throw new ShopError('Telegram ID власника — додатні числа через кому.');
 if(s.brand!=='FORMULOVE'||!['demo','live'].includes(s.mode))throw new ShopError('Назва FORMULOVE; режим demo або live.');
 for(const key of ['seller_name','seller_details','dispatch_text','delivery_text','returns_text','privacy_text','care_text','payment_text','bank_details'])if(typeof s[key]!=='string'||s[key].length>2500)throw new ShopError('Перевірте текст '+key+' (до 2500 символів).');
 for(const key of ['support_url','instagram_url'])if(s[key]&&(!/^https:\/\/[A-Za-z0-9./_?=&%+-]+$/.test(s[key])||s[key].length>250))throw new ShopError('Потрібне HTTPS-посилання '+key);
 if(!Array.isArray(s.payment_methods)||!s.payment_methods.length||s.payment_methods.some(p=>!PAYMENTS[p]))throw new ShopError('Способи оплати: cod, transfer та/або card.');
 if(!Array.isArray(s.packages)||s.packages.length<1||s.packages.length>5||new Set(s.packages.map(p=>p.id)).size!==s.packages.length||!s.packages.some(p=>p.id==='standard'))throw new ShopError('Потрібні унікальні пакування та standard.');
 for(const p of s.packages)if(!/^[a-z0-9]{1,16}$/.test(p.id)||!Number.isInteger(p.price_uah)||p.price_uah<0||p.price_uah>10000||typeof p.name!=='string'||p.name.length>80||typeof p.description!=='string'||p.description.length>500)throw new ShopError('Перевірте назву, ціну й опис пакування.');
 if(!Number.isInteger(s.max_cart_units)||s.max_cart_units<1||s.max_cart_units>20||!Number.isInteger(s.max_cart_lines)||s.max_cart_lines<1||s.max_cart_lines>10)throw new ShopError('Кошик: до 20 одиниць та до 10 рядків.');
}
export function variants(catalog){const rows=[];for(const p of catalog.products)for(const c of p.colors)for(const s of p.sizes)for(const s2 of p.pair?p.sizes:[''])rows.push({variant:[p.id,c.id,s,s2].join(':'),quantity:p.initial_stock});return rows;}

export async function initialize(db){
 validateCatalog(DEFAULT_CATALOG);validateStore(DEFAULT_STORE);
 const store={...DEFAULT_STORE,revision:randomToken()};
 const tasks=[...SCHEMA.map(q=>db.prepare(q)),stmt(db,"INSERT OR IGNORE INTO settings VALUES('store',?)",[JSON.stringify(store)]),stmt(db,"INSERT OR IGNORE INTO settings VALUES('categories',?)",[JSON.stringify(DEFAULT_CATALOG.categories)]),stmt(db,"INSERT OR IGNORE INTO products(id,price,active,data) SELECT json_extract(value,'$.id'),json_extract(value,'$.price_uah'),json_extract(value,'$.active'),value FROM json_each(?)",[JSON.stringify(DEFAULT_CATALOG.products)]),stmt(db,"INSERT OR IGNORE INTO stock(variant,quantity) SELECT json_extract(value,'$.variant'),json_extract(value,'$.quantity') FROM json_each(?)",[JSON.stringify(variants(DEFAULT_CATALOG))])];
 await db.batch(tasks);
}

export class Shop {
 constructor(env){this.env=env;this.db=env.DB;this.secretAdminIds=adminIds(env).length?env.ADMIN_IDS:undefined;}
 async load(){
  await ensureCommerce(this.db);
  const rows=await this.db.batch([stmt(this.db,"SELECT key,value FROM settings WHERE key IN('store','categories')"),stmt(this.db,'SELECT id,price,active,data FROM products'),stmt(this.db,'SELECT key,file_id,kind FROM assets')]);
  const s=Object.fromEntries((rows[0].results||[]).map(r=>[r.key,JSON.parse(r.value)]));if(!s.store)throw new ShopError('Магазин ще налаштовується. Спробуйте пізніше.');
  this.store=customerStoreCopy({...s.store,sales_mode:s.store.sales_mode||'preorder',admin_ids:s.store.admin_ids||DEFAULT_STORE.admin_ids||'',seller_name:s.store.seller_name||DEFAULT_STORE.seller_name,seller_details:s.store.seller_details||DEFAULT_STORE.seller_details,support_url:s.store.support_url||DEFAULT_STORE.support_url,dispatch_text:s.store.dispatch_text?.startsWith('Тестова колекція.')?DEFAULT_STORE.dispatch_text:s.store.dispatch_text});this.env={...this.env,ADMIN_IDS:this.secretAdminIds||this.store.admin_ids};this.categories=s.categories;this.products=Object.fromEntries((rows[1].results||[]).map(r=>[r.id,customerProductCopy({...JSON.parse(r.data),price_uah:r.price,active:!!r.active})]));this.assets=Object.fromEntries((rows[2].results||[]).map(r=>[r.key,r]));return this;
 }
 get(pid){const p=this.products[pid];if(!p||!p.active)throw new ShopError('Цей товар зараз недоступний.');return p;}
 paymentMethods(){const methods=[...new Set([...this.store.payment_methods,...(this.store.card_enabled!==false?['card']:[])])];return methods.filter(k=>k!=='card'||(this.store.card_enabled!==false&&onlineReady(this.env)));}
 variant(pid,color,size,size2=''){
  const p=this.get(pid);if(!p.colors.some(c=>c.id===color)||!p.sizes.includes(size)|| (p.pair?!p.sizes.includes(size2):!!size2))throw new ShopError('Оберіть актуальний колір і розмір.');return [pid,color,size,size2].join(':');
 }
 parseVariant(key){const a=key.split(':');if(a.length!==4)throw new ShopError('Некоректний варіант.');this.variant(...a);const p=this.get(a[0]);return {p,label:p.colors.find(c=>c.id===a[1]).name+' · '+a[2]+(a[3]?' / '+a[3]:'')};}
 async stock(key){return (await first(this.db,'SELECT quantity FROM stock WHERE variant=?',[key]))?.quantity??0;}
 async cart(uid){return all(this.db,'SELECT * FROM carts WHERE user_id=? ORDER BY id',[uid]);}
 async session(uid){const row=await first(this.db,'SELECT data,last_update FROM sessions WHERE user_id=?',[uid]);return row?{...JSON.parse(row.data),last_update:row.last_update}:{};}
 async saveSession(uid,data,update=0){return run(this.db,'INSERT INTO sessions VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET data=excluded.data,last_update=excluded.last_update',[uid,JSON.stringify(data),update]);}
 async reset(uid){return run(this.db,'DELETE FROM sessions WHERE user_id=?',[uid]);}
 async changeCart(uid,key,change,op){
  if(change!=='remove')this.parseVariant(key);
  const sql=change==='remove'?'DELETE FROM carts WHERE user_id=? AND variant=? AND NOT EXISTS(SELECT 1 FROM mutations WHERE operation=?)':change===1?'INSERT INTO carts(user_id,variant,quantity) SELECT ?,?,1 WHERE NOT EXISTS(SELECT 1 FROM mutations WHERE operation=?) ON CONFLICT(user_id,variant) DO UPDATE SET quantity=quantity+1':'UPDATE carts SET quantity=quantity-1 WHERE user_id=? AND variant=? AND quantity>1 AND NOT EXISTS(SELECT 1 FROM mutations WHERE operation=?)';
  const tasks=[stmt(this.db,sql,[uid,key,op])];
  if(change===-1)tasks.unshift(stmt(this.db,"DELETE FROM carts WHERE user_id=? AND variant=? AND quantity=1 AND NOT EXISTS(SELECT 1 FROM mutations WHERE operation=?)",[uid,key,op]));
  // Distinguish a deletion from a decrement: both must not run on a quantity that changed from 2 to 1.
  tasks.push(stmt(this.db,'INSERT OR IGNORE INTO mutations VALUES(?,?)',[op,epoch()]));
  await this.db.batch(tasks);
 }
 async quote(uid,packageId='standard'){
  const pack=this.store.packages.find(p=>p.id===packageId);if(!pack)throw new ShopError('Оберіть пакування зі списку.');
  const cart=await all(this.db,'SELECT c.*,s.quantity AS available FROM carts c JOIN stock s ON s.variant=c.variant WHERE user_id=? ORDER BY c.id',[uid]);if(!cart.length)throw new ShopError('Кошик порожній. Спочатку оберіть товар.');
  const items=cart.map(r=>{const {p,label}=this.parseVariant(r.variant);if(r.available!==-1&&r.quantity>r.available)throw new ShopError('Наявність змінилася. Оновіть кошик.');return {line_id:r.id,variant:r.variant,product_id:p.id,name:p.name,label,quantity:r.quantity,unit_price:p.price_uah,preorder:r.available===-1};});
  const goods=items.reduce((s,i)=>s+i.quantity*i.unit_price,0);const q={items,goods,packaging:pack.price_uah,package_name:pack.name,package_id:pack.id,total:goods+pack.price_uah,revision:this.store.revision};q.fingerprint=await sha(JSON.stringify(q));return q;
 }
 validateCustomer(c){
  if(!c||['name','phone','city','delivery','branch','payment','package'].some(k=>typeof c[k]!=='string'||!c[k])||c.consent!==true)throw new ShopError('Завершіть оформлення та погодьте обробку даних.');
  if(c.name.length>100||c.name.trim().split(/\s+/).length<2||phone(c.phone)!==c.phone||c.city.length<2||c.city.length>100||c.branch.length>160||(c.comment||'').length>500||!DELIVERY[c.delivery]||!this.paymentMethods().includes(c.payment))throw new ShopError('Перевірте контактні дані, доставку й оплату.');
 }
 async order(id){const o=await first(this.db,'SELECT * FROM orders WHERE id=?',[id]);return o?{...o,items:JSON.parse(o.items),customer:JSON.parse(o.customer)}:null;}
 async place(uid,token,customer,fingerprint){
  const old=await first(this.db,'SELECT id,user_id FROM orders WHERE token=?',[token]);if(old){if(old.user_id!==uid)throw new ShopError('Підтвердження недійсне.');return {order:await this.order(old.id),created:false};}
  const account=await first(this.db,'SELECT phone,verified_at FROM customers WHERE user_id=?',[uid]);if(!account?.verified_at)throw new ShopError('Підтвердіть свій номер кнопкою Telegram: /start.');
  this.validateCustomer(customer);const q=await this.quote(uid,customer.package);if(q.fingerprint!==fingerprint)throw new ShopError('Кошик або ціни змінилися. Перевірте замовлення ще раз.');
  if(this.store.mode==='live'&&this.liveIssues().length)throw new ShopError('Магазин оновлюється. Зверніться до FORMULOVE.');
  const data={...customer,buyer_phone:account.phone,sale_type:this.store.sales_mode||'ready',preorder_notice:this.store.sales_mode==='preorder'?PREORDER_NOTICE:'',consent_at:stamp(),policy_hash:await sha(this.store.privacy_text+this.store.returns_text+this.store.payment_text)};
  try{
   await run(this.db,'INSERT INTO orders(user_id,token,created_at,mode,items,customer,package_name,goods_total,packaging_total,total,admin_targets,store_version) VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(token) DO NOTHING',[uid,token,stamp(),this.store.mode,JSON.stringify(q.items),JSON.stringify(data),q.package_name,q.goods,q.packaging,q.total,JSON.stringify(targets(this.env)),this.store.revision]);
  }catch(error){const existing=await first(this.db,'SELECT id,user_id FROM orders WHERE token=?',[token]);if(existing&&existing.user_id===uid)return {order:await this.order(existing.id),created:false};throw error;}
  const row=await first(this.db,'SELECT id,user_id FROM orders WHERE token=?',[token]);if(!row||row.user_id!==uid)throw new ShopError('Не вдалося підтвердити замовлення.');return {order:await this.order(row.id),created:true};
 }
 async status(id,status,actor,{buyer=false,tracking=''}={}){
  const o=await this.order(id);if(!o)throw new ShopError('Замовлення не знайдено.');
  if(buyer){if(o.user_id!==actor||status!=='cancelled'||o.status!=='new')throw new ShopError('Для зміни зверніться до менеджера.');}
  else if(!adminIds(this.env).includes(actor))throw new ShopError('Немає доступу.');
  if(!(NEXT[o.status]||[]).includes(status))throw new ShopError('Цей перехід статусу недоступний.');
  if(status==='shipped'&&!/^\d{14}$/.test(tracking))throw new ShopError('Вкажіть 14-значну ТТН: /ship номер_замовлення ТТН');
  const tasks=[stmt(this.db,"UPDATE orders SET status=?,tracking=CASE WHEN ?!='' THEN ? ELSE tracking END WHERE id=? AND status=?",[status,tracking,tracking,id,o.status])];
  if(status==='paid'){
   const invoice=await first(this.db,'SELECT invoice_id,state FROM payment_invoices WHERE order_id=?',[id]);if(invoice?.invoice_id&&!['failure','expired','reversed'].includes(invoice.state))throw new ShopError('Спершу перевірте оплату рахунку monobank.');
   tasks.push(stmt(this.db,"INSERT OR IGNORE INTO order_money(order_id,kind,amount,reference,source,created_at) SELECT ?,'receipt',total*100-COALESCE((SELECT SUM(amount) FROM order_money WHERE order_id=? AND kind='receipt'),0),?,'manual',? FROM orders WHERE id=? AND total*100>COALESCE((SELECT SUM(amount) FROM order_money WHERE order_id=? AND kind='receipt'),0)",[id,id,'manual:'+id,stamp(),id,id]));
  }
  const result=await this.db.batch(tasks);if(result[0].meta.changes!==1)throw new ShopError('Статус уже змінився. Оновіть замовлення.');return this.order(id);
 }
 liveIssues(){
  const s=this.store,issues=[],labels={seller_name:'Назва / ПІБ продавця',seller_details:'Інформація про продавця',support_url:'Робочий контакт продавця',dispatch_text:'Умови виготовлення та відправлення'};
  for(const k of Object.keys(labels))if(!s[k])issues.push(labels[k]);
  if(s.catalog_confirmed!==true)issues.push('Підтвердіть ціни, асортимент і дизайни');
  if(s.terms_confirmed!==true)issues.push('Підтвердіть умови покупки');
  if(!adminIds({...this.env,ADMIN_IDS:this.secretAdminIds||s.admin_ids}).length)issues.push('Telegram ID власника: команда /id у боті → поле в панелі');
  if(s.payment_methods.includes('transfer')&&!s.bank_details)issues.push('Реквізити для оплати');
  if(!this.paymentMethods().length)issues.push('Додайте доступний спосіб оплати');
  if(s.sales_mode==='preorder'){
   for(const p of Object.values(this.products))if(p.active&&!p.photo&&!this.assets['product:'+p.id]&&!Object.hasOwn(CONCEPT_PHOTOS,p.id))issues.push(p.name+': додайте фото або мокап');
  }else{
   if(s.images_are_concepts)issues.push('Для готових товарів потрібні фото зразків; для мокапів оберіть передзамовлення');
   for(const p of Object.values(this.products))if(p.active&&(!p.photo_confirmed||!p.measurements.length||(!p.photo&&!this.assets['product:'+p.id])))issues.push(p.name+': фото готового зразка та заміри');
  }
  return issues;
 }
 async saveConfig(store,catalog){
  validateStore(store);validateCatalog(catalog);
  const previousStore=this.store,previousProducts=this.products;store={...store,revision:randomToken()};
  this.store=store;this.products=Object.fromEntries(catalog.products.map(p=>[p.id,p]));
  if(store.mode==='live'&&this.liveIssues().length){const issues=this.liveIssues();this.store=previousStore;this.products=previousProducts;throw new ShopError('Для live заповніть: '+issues.join('; '));}
  const tasks=[stmt(this.db,"INSERT INTO settings VALUES('store',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",[JSON.stringify(store)]),stmt(this.db,"INSERT INTO settings VALUES('categories',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",[JSON.stringify(catalog.categories)]),stmt(this.db,'UPDATE products SET active=0'),stmt(this.db,"INSERT INTO products(id,price,active,data) SELECT json_extract(value,'$.id'),json_extract(value,'$.price_uah'),json_extract(value,'$.active'),value FROM json_each(?) WHERE 1 ON CONFLICT(id) DO UPDATE SET price=excluded.price,active=excluded.active,data=excluded.data",[JSON.stringify(catalog.products)]),stmt(this.db,"INSERT OR IGNORE INTO stock(variant,quantity) SELECT json_extract(value,'$.variant'),json_extract(value,'$.quantity') FROM json_each(?)",[JSON.stringify(variants(catalog))])];
  await this.db.batch(tasks);return this.load();
 }
}

export class TelegramError extends Error {constructor(code=0,retry=0){super('Telegram request failed');this.code=code;this.retry=retry;}}
export async function telegram(env,method,payload){
 let response,data;try{response=await fetch('https://api.telegram.org/bot'+env.BOT_TOKEN+'/'+method,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(15000)});data=await response.json();}catch{throw new TelegramError();}
 if(!response.ok||!data.ok)throw new TelegramError(data.error_code||response.status,data.parameters?.retry_after||0);return data.result;
}
export function btn(text,data){if(new TextEncoder().encode(data).length>64)throw new Error('Callback limit');return {text,callback_data:data};}
export const kb=(...rows)=>({inline_keyboard:rows.filter(r=>r?.length)});
export const HOME={keyboard:[[{text:'Показати все'},{text:'Каталог'}],[{text:'Кошик'},{text:'Мої замовлення'}],[{text:'Мій профіль'},{text:'Допомога'}]],resize_keyboard:true,is_persistent:true};
export async function send(env,uid,text,markup=kb([btn('Головне меню','home')])){
 if(text.length>4000)throw new ShopError('Повідомлення завелике. Скоротіть текст у налаштуваннях.');
 return telegram(env,'sendMessage',{chat_id:uid,text,parse_mode:'HTML',reply_markup:markup,link_preview_options:{is_disabled:true}});
}
export async function media(env,uid,asset,caption,markup){
 if(!asset)return false;
 const payload={chat_id:uid,caption,...(markup?{parse_mode:'HTML',reply_markup:markup}:{})};
 try{if(asset.kind==='document')await telegram(env,'sendDocument',{...payload,document:asset.file_id});else await telegram(env,'sendPhoto',{...payload,photo:asset.file_id||asset});return true;}catch(error){if(error.code===403)throw error;return false;}
}
