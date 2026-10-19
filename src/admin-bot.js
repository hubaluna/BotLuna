import {ShopError,TelegramError,STATUS,HOME,adminIds,first,all,run,stmt,stamp,randomToken,esc,money,kb,btn,validateCatalog,validateStore,onlineReady,variants} from './core.js';
import {analytics,accountingCSV,csvTable,expense,pennies,cash,balances,recordRefund} from './commerce.js';

export const ADMIN_HOME={keyboard:[[{text:'Замовлення'},{text:'Товари'}],[{text:'Склад'},{text:'Покупці'}],[{text:'Фінанси'},{text:'Розсилки'}],[{text:'Налаштування'},{text:'Експорт'}],[{text:'Переглянути магазин'},{text:'Вебкабінет'}]],resize_keyboard:true,is_persistent:true};
export const OWNER_SHOP_HOME={...HOME,keyboard:[...HOME.keyboard,[{text:'Адмін-панель'}]]};
const FIELD_NAMES={name:'Назва',price_uah:'Ціна',description:'Опис',materials:'Матеріали',fit:'Посадка',embroidery:'Вишивка',measurements:'Заміри'};
const STORE_FIELDS={dispatch_text:'Виготовлення й відправлення',delivery_text:'Доставка',payment_text:'Оплата',returns_text:'Обміни й повернення',support_url:'Контакт покупців',instagram_url:'Instagram',seller_name:'Назва продавця',seller_details:'Дані продавця',care_text:'Догляд',privacy_text:'Обробка даних'};
const COSTS={production:'Товар і виробництво',ads:'Реклама',shipping:'Доставка',fees:'Комісії',tax:'Податки',other:'Інше'};
const trimName=(s,n=48)=>String(s).length>n?String(s).slice(0,n-1)+'…':String(s);
const number=(value,max=100000)=>{if(!/^\d+$/.test(String(value))||!Number.isSafeInteger(Number(value))||Number(value)>max)throw new ShopError('Відкрийте розділ ще раз.');return Number(value);};
const rangeDays=days=>({from:new Date(Date.now()-(days-1)*86400000).toISOString().slice(0,10),to:stamp().slice(0,10)});

export class AdminBot{
 constructor(bot){this.bot=bot;this.shop=bot.shop;this.db=bot.db;this.env=bot.env;this.uid=bot.uid;}
 allowed(){return adminIds(this.env).includes(this.uid);}
 guard(){if(!this.allowed())throw new ShopError('Керування доступне лише адміністратору.');}
 send(text,markup){return this.bot.send(text,markup);}
 panelURL(){return this.env.PUBLIC_BASE_URL?new URL('/setup',this.env.PUBLIC_BASE_URL).href:'';}
 back(action='am:home'){return [btn('Назад',action),btn('Кабінет адміністратора','am:home')];}
 productData(pid){const p=this.shop.products[pid];if(!p)throw new ShopError('Товар не знайдено.');return p;}
 async dashboard(){
  this.guard();await this.shop.reset(this.uid);
  const o=await first(this.db,"SELECT COALESCE(SUM(mode='live' AND status='new'),0) new,COALESCE(SUM(mode='live' AND status IN('confirmed','paid','processing')),0) processing,COALESCE(SUM(mode='live' AND status='shipped'),0) shipped,COALESCE(SUM(mode='demo'),0) demo FROM orders"),c=await first(this.db,'SELECT COUNT(*) n FROM customers');
  await this.send('<b>FORMULOVE · Кабінет адміністратора</b>\n\nНові live-замовлення: '+o.new+'\nУ роботі: '+o.processing+'\nВідправлені: '+o.shipped+'\nПрофілі покупців: '+c.n+'\nТестові замовлення: '+o.demo+'\n\nМагазин: '+(this.shop.store.orders_paused?'приймання призупинено · ':'')+(this.shop.store.mode==='live'?'реальні продажі':'тестовий режим')+'\nОберіть розділ кнопками нижче.',ADMIN_HOME);
 }
 async orders(status='all',offset=0,mode='live'){
  this.guard();if(!['all',...Object.keys(STATUS)].includes(status)||!['live','demo','all'].includes(mode))throw new ShopError('Оберіть фільтр замовлень.');offset=number(offset);
  const where=[],args=[];if(status!=='all'){where.push('status=?');args.push(status);}if(mode!=='all'){where.push('mode=?');args.push(mode);}const clause=where.length?' WHERE '+where.join(' AND '):'';
  const rows=await all(this.db,'SELECT id,status,total,mode,customer FROM orders'+clause+' ORDER BY id DESC LIMIT 11 OFFSET ?',[...args,offset]);
  const buttons=rows.slice(0,10).map(o=>[btn('№'+o.id+' · '+trimName(JSON.parse(o.customer).name,24)+' · '+money(o.total),'order:'+o.id)]);
  const nav=[];if(offset)nav.push(btn('Попередні','am:orders:'+status+':'+Math.max(0,offset-10)+':'+mode));if(rows.length>10)nav.push(btn('Наступні','am:orders:'+status+':'+(offset+10)+':'+mode));
  buttons.push(nav,[btn('Фільтри','am:orderfilters'),btn('Знайти замовлення','am:search:orders')],this.back());
  return this.send('<b>Замовлення · '+(mode==='live'?'live':mode==='demo'?'тестові':'усі режими')+'</b>\n'+(status==='all'?'Усі статуси':STATUS[status])+(rows.length?'\nОберіть замовлення.':'\nЗа цим фільтром замовлень немає.'),kb(...buttons));
 }
 async orderFilters(){this.guard();return this.send('<b>Фільтри замовлень</b>',kb(...Object.entries(STATUS).map(([k,v])=>[btn(v,'am:orders:'+k+':0:live')]),[btn('Усі live','am:orders:all:0:live'),btn('Тестові','am:orders:all:0:demo')],[btn('Усі режими','am:orders:all:0:all')],this.back('am:orders')));}
 async catalogue(kind='catalog',offset=0){
  this.guard();if(!['catalog','stock','media'].includes(kind))throw new ShopError('Оберіть каталог.');offset=number(offset);const products=Object.values(this.shop.products),rows=products.slice(offset,offset+10).map(p=>[btn((p.active?'':'Приховано · ')+trimName(p.name,42),kind==='stock'?'am:stock:'+p.id+':0':'am:product:'+p.id)]),nav=[];
  if(offset)nav.push(btn('Попередні','am:catalog:'+kind+':'+Math.max(0,offset-10)));if(offset+10<products.length)nav.push(btn('Наступні','am:catalog:'+kind+':'+(offset+10)));rows.push(nav,this.back());
  return this.send('<b>'+(kind==='stock'?'Склад':kind==='media'?'Зображення товарів':'Керування товарами')+'</b>\n'+products.length+' моделей, включно з прихованими.',kb(...rows));
 }
 async product(pid){
  this.guard();const p=this.productData(pid),rows=[[btn('Ціна','am:edit:'+pid+':price_uah'),btn('Назва','am:edit:'+pid+':name')],[btn('Опис','am:edit:'+pid+':description'),btn('Заміри','am:edit:'+pid+':measurements')],[btn('Матеріали','am:edit:'+pid+':materials'),btn('Посадка','am:edit:'+pid+':fit')],[btn('Фото товару','am:upload:'+pid+':photo'),btn('Картинка розмірів','am:upload:'+pid+':size')],[btn('Залишки','am:stock:'+pid+':0'),btn(p.active?'Приховати':'Показати','am:visibility:'+pid)],[btn('Створити нову модель на цій основі','am:new:'+pid)]];if(p.active)rows.push([btn('Переглянути картку','product:'+pid)]);rows.push(this.back('am:catalog'));
  return this.send('<b>'+esc(p.name)+'</b>\n'+money(p.price_uah)+' · '+(p.active?'видимий':'прихований')+'\n\n'+esc(p.description),kb(...rows));
 }
 async stock(pid,offset=0){
  this.guard();const p=this.productData(pid);offset=number(offset,3000);const rows=await all(this.db,'SELECT variant,quantity FROM stock WHERE variant LIKE ? ORDER BY variant LIMIT 11 OFFSET ?',[pid+':%',offset]);
  const buttons=rows.slice(0,10).map((r,i)=>{const a=r.variant.split(':'),color=p.colors.find(c=>c.id===a[1])?.name||a[1],label=color+' · '+a[2]+(a[3]?' / '+a[3]:'');return [btn(trimName(label,40)+' · '+(r.quantity===-1?'під замовлення':r.quantity),'am:stockset:'+pid+':'+(offset+i))];});const nav=[];if(offset)nav.push(btn('Попередні','am:stock:'+pid+':'+Math.max(0,offset-10)));if(rows.length>10)nav.push(btn('Наступні','am:stock:'+pid+':'+(offset+10)));buttons.push(nav,this.back('am:product:'+pid));
  return this.send('<b>Склад · '+esc(p.name)+'</b>\nКількість вільного залишку; −1 означає виробництво під замовлення.',kb(...buttons));
 }
 async customers(offset=0){
  this.guard();offset=number(offset);const rows=await all(this.db,'SELECT user_id,phone,full_name FROM customers ORDER BY user_id DESC LIMIT 11 OFFSET ?',[offset]),buttons=rows.slice(0,10).map(p=>[btn(trimName(p.full_name||p.phone,45),'am:customer:'+p.user_id)]),nav=[];if(offset)nav.push(btn('Попередні','am:customers:'+Math.max(0,offset-10)));if(rows.length>10)nav.push(btn('Наступні','am:customers:'+(offset+10)));buttons.push(nav,[btn('Пошук за ім’ям або номером','am:search:customers')],this.back());return this.send('<b>Покупці</b>\n'+(rows.length?'Оберіть профіль.':'Профілів поки немає.'),kb(...buttons));
 }
 async customer(uid){
  this.guard();uid=number(uid,Number.MAX_SAFE_INTEGER);const p=await first(this.db,'SELECT * FROM customers WHERE user_id=?',[uid]);if(!p)throw new ShopError('Профіль не знайдено.');const counts=await first(this.db,"SELECT COUNT(*) count,COALESCE(SUM(CASE WHEN mode='live' AND status!='cancelled' THEN total ELSE 0 END),0) total FROM orders WHERE user_id=?",[uid]);
  return this.send('<b>'+esc(p.full_name||'Покупець')+'</b>\n'+esc(p.phone)+'\nTelegram ID: <code>'+uid+'</code>\nЗамовлень усіх режимів: '+counts.count+'\nСума live без скасованих: '+money(counts.total)+'\nНовини: '+(p.marketing?'є згода':'без підписки')+'\nЗареєстровано: '+p.created_at.slice(0,10),kb([btn('Замовлення покупця','am:customerorders:'+uid+':0')],this.back('am:customers')));
 }
 async customerOrders(uid,offset=0){this.guard();uid=number(uid,Number.MAX_SAFE_INTEGER);offset=number(offset);const rows=await all(this.db,'SELECT id,status,total,mode FROM orders WHERE user_id=? ORDER BY id DESC LIMIT 11 OFFSET ?',[uid,offset]),buttons=rows.slice(0,10).map(o=>[btn('№'+o.id+' · '+STATUS[o.status]+' · '+money(o.total)+(o.mode==='demo'?' · тест':''),'order:'+o.id)]),nav=[];if(offset)nav.push(btn('Попередні','am:customerorders:'+uid+':'+Math.max(0,offset-10)));if(rows.length>10)nav.push(btn('Наступні','am:customerorders:'+uid+':'+(offset+10)));return this.send('<b>Замовлення покупця</b>',kb(...buttons,nav,this.back('am:customer:'+uid)));}
 async finance(days=30){this.guard();days=number(days,365);if(![1,7,30,90,365].includes(days))throw new ShopError('Оберіть період.');const r=await analytics(this.shop,rangeDays(days)),s=r.summary;return this.send('<b>Фінанси · '+days+' дн.</b>\nТільки live, дати UTC.\n\nЗамовлень: '+s.orders+'\nСума без скасованих: '+money(s.ordered_uah)+'\nСередній чек: '+money(s.average_order_uah)+'\nОтримані оплати: '+cash(s.received_kopecks)+'\nПовернення: '+cash(s.refunded_kopecks)+'\nВнесені витрати: '+cash(s.expenses_kopecks)+'\nРізниця: '+cash(s.recorded_cash_difference)+'\n\nРізниця не дорівнює чистому прибутку: усі витрати потрібно внести.',kb([btn('Сьогодні','am:finance:1'),btn('7 днів','am:finance:7'),btn('30 днів','am:finance:30')],[btn('90 днів','am:finance:90'),btn('Рік','am:finance:365')],[btn('Додати витрату','am:expense')],[btn('Записати повернення','am:refund')],[btn('Звіти CSV','am:exports')],this.back()));}
 async campaigns(offset=0){
  this.guard();offset=number(offset);const rows=await all(this.db,"SELECT c.*,COUNT(d.user_id) recipients,SUM(d.state='done') delivered FROM campaigns c LEFT JOIN campaign_deliveries d ON d.campaign_id=c.id GROUP BY c.id ORDER BY c.id DESC LIMIT 9 OFFSET ?",[offset]),buttons=rows.slice(0,8).map(c=>[btn('№'+c.id+' · '+({draft:'чернетка',queued:'у черзі',done:'завершено',cancelled:'зупинено'}[c.state]||c.state)+' · '+(c.delivered||0)+'/'+c.recipients,'am:campaign:'+c.id)]),nav=[];if(offset)nav.push(btn('Попередні','am:campaigns:'+Math.max(0,offset-8)));if(rows.length>8)nav.push(btn('Наступні','am:campaigns:'+(offset+8)));return this.send('<b>Розсилки</b>\nЛише підписникам, які дали згоду.',kb([btn('Створити новину','campaignstart')],...buttons,nav,this.back()));
 }
 async campaign(id){this.guard();id=number(id);const c=await first(this.db,'SELECT * FROM campaigns WHERE id=?',[id]);if(!c)throw new ShopError('Розсилку не знайдено.');const stats=await all(this.db,'SELECT state,COUNT(*) n FROM campaign_deliveries WHERE campaign_id=? GROUP BY state',[id]),rows=[];if(c.state==='draft')rows.push([btn('Підтвердити надсилання','campaignsend:'+id)]);if(['draft','queued'].includes(c.state))rows.push([btn('Зупинити розсилку','am:campaignstop:'+id)]);rows.push(this.back('am:campaigns'));return this.send('<b>Розсилка №'+id+'</b>\n'+({draft:'Чернетка',queued:'У черзі',done:'Завершено',cancelled:'Зупинено'}[c.state]||c.state)+'\n\n'+esc(c.text.slice(0,1400))+'\n\n'+stats.map(r=>({done:'Доставлено',pending:'Очікують',sending:'Надсилаються',skipped:'Пропущено'}[r.state]||r.state)+': '+r.n).join('\n'),kb(...rows));}
 async settings(){this.guard();const s=this.shop.store,rows=Object.entries(STORE_FIELDS).map(([k,v])=>[btn(v,'am:setting:'+k)]);rows.push([btn('Режим продажів','am:modes')],[btn(s.orders_paused?'Відновити замовлення':'Призупинити замовлення','am:pause')],[btn('Обкладинка бота','am:asset:welcome'),btn('Фото пакування','am:asset:packaging')],[btn('Платежі та доступ','am:access')],this.back());return this.send('<b>Налаштування магазину</b>\nКонтакт: '+esc(s.support_url||'не вказано')+'\nОнлайн-оплата: '+(onlineReady(this.env)?'ключі додані':'очікує підключення')+'\n\nОберіть, що змінити.',kb(...rows));}
 async exports(){this.guard();return this.send('<b>Експорт CSV</b>\nФінансові звіти: live за 30 днів. Вивантаження покупців містить контакти.',kb([btn('Замовлення · до 1000','am:export:allorders')],[btn('Товари · live','am:export:items'),btn('Оплати · live','am:export:money')],[btn('Витрати · live','am:export:expenses')],[btn('Покупці · до 10 000','am:export:customers')],this.back()));}
 async file(type){
  this.guard();if(type==='allorders')return this.bot.export();let csv;
  if(type==='customers'){const rows=await all(this.db,'SELECT user_id,full_name,phone,created_at,marketing FROM customers ORDER BY user_id LIMIT 10001');if(rows.length>10000)throw new ShopError('Понад 10 000 профілів. Скористайтеся експортом D1.');csv=csvTable([['Telegram ID','Ім’я','Телефон','Дата','Згода на новини'],...rows.map(p=>[p.user_id,p.full_name,p.phone,p.created_at,p.marketing?'так':'ні'])]);}
  else csv=await accountingCSV(this.shop,type,rangeDays(30));
  const form=new FormData();form.append('chat_id',String(this.uid));form.append('document',new Blob([csv],{type:'text/csv'}),'FORMULOVE_'+type+'.csv');form.append('caption',type==='customers'?'Контакти покупців. Зберігайте файл приватно.':'Live · останні 30 днів · UTC');let r,data;try{r=await fetch('https://api.telegram.org/bot'+this.env.BOT_TOKEN+'/sendDocument',{method:'POST',body:form,signal:AbortSignal.timeout(15000)});data=await r.json();}catch{throw new TelegramError();}if(!r.ok||!data.ok)throw new TelegramError(data.error_code||r.status);
 }
 async prompt(kind,extra={},text='Надішліть нове значення.'){
  this.guard();const s={step:'am_input',kind,token:randomToken(),...extra};await this.shop.saveSession(this.uid,s,this.bot.updateId);return this.send(text,kb([btn('Скасувати','am:home')]));
 }
 async preview(s,value,label){s.step='am_confirm';s.value=value;await this.shop.saveSession(this.uid,s,this.bot.updateId);return this.send('<b>Перевірте зміну</b>\n'+esc(label),kb([btn('Зберегти','am:apply:'+s.token)],[btn('Скасувати','am:home')]));}
 async updateProduct(pid,field,value,expected){
  this.guard();const row=await first(this.db,'SELECT * FROM products WHERE id=?',[pid]);if(!row)throw new ShopError('Товар не знайдено.');if(expected!==undefined&&JSON.stringify([row.data,row.price,row.active])!==expected)throw new ShopError('Товар уже змінено. Відкрийте його й повторіть редагування.');
  const p={...JSON.parse(row.data),price_uah:row.price,active:!!row.active,[field]:value};validateCatalog({currency:'UAH',categories:this.shop.categories,products:[p]});
  const old=this.shop.products[pid];this.shop.products[pid]=p;try{if(field==='active'&&value&&this.shop.store.mode==='live'&&this.shop.liveIssues().length)throw new ShopError('Товар ще не готовий до live. Перевірте фото, заміри й налаштування в панелі.');}catch(e){this.shop.products[pid]=old;throw e;}
  const data={...JSON.parse(row.data),[field]:value};const result=await this.db.batch([stmt(this.db,'UPDATE products SET data=?,price=?,active=? WHERE id=? AND data=? AND price=? AND active=?',[JSON.stringify(data),p.price_uah,p.active?1:0,pid,row.data,row.price,row.active]),stmt(this.db,"UPDATE settings SET value=json_set(value,'$.revision',?) WHERE key='store'",[randomToken()])]);if(result[0].meta.changes!==1)throw new ShopError('Товар уже змінився. Повторіть редагування.');await this.shop.load();
 }
 async createProduct(p){
  this.guard();if(this.shop.products[p.id])throw new ShopError('Такий ID товару вже існує.');const count=await first(this.db,'SELECT COUNT(*) n FROM products');if(count.n>=100)throw new ShopError('Ліміт каталогу — 100 моделей.');
  validateCatalog({currency:'UAH',categories:this.shop.categories,products:[p]});if(p.active||p.photo||p.photo_confirmed||p.initial_stock!==0)throw new ShopError('Нова модель створюється прихованою, без фото й залишків.');
  const result=await this.db.batch([stmt(this.db,'INSERT INTO products(id,price,active,data) SELECT ?,?,0,? WHERE (SELECT COUNT(*) FROM products)<100',[p.id,p.price_uah,JSON.stringify(p)]),stmt(this.db,"INSERT INTO stock(variant,quantity) SELECT json_extract(value,'$.variant'),0 FROM json_each(?) WHERE EXISTS(SELECT 1 FROM products WHERE id=? AND data=?)",[JSON.stringify(variants({products:[p]})),p.id,JSON.stringify(p)]),stmt(this.db,"UPDATE settings SET value=json_set(value,'$.revision',?) WHERE key='store'",[randomToken()])]);if(result[0].meta.changes!==1)throw new ShopError('Каталог заповнений. Нову модель не створено.');await this.shop.load();
 }
 async updateSetting(field,value,expected){
  this.guard();if(!Object.hasOwn(STORE_FIELDS,field)&&!['mode','sales_mode','orders_paused'].includes(field))throw new ShopError('Це поле не змінюється через чат.');if(this.shop.store.revision!==expected)throw new ShopError('Налаштування змінилися. Відкрийте розділ ще раз.');const previous=this.shop.store,next={...previous,[field]:value,revision:randomToken()};validateStore(next);this.shop.store=next;
  const issues=this.shop.liveIssues();if(next.mode==='live'&&issues.length){this.shop.store=previous;throw new ShopError('Для live потрібно: '+issues.slice(0,6).join('; '));}
  const r=await run(this.db,"UPDATE settings SET value=? WHERE key='store' AND json_extract(value,'$.revision')=?",[JSON.stringify(next),expected]);if(r.meta.changes!==1)throw new ShopError('Налаштування вже змінилися. Повторіть дію.');await this.shop.load();
 }
 async input(s,text,m){
  this.guard();if(s.kind==='search'){
   if(text.length<1||text.length>100)throw new ShopError('Пошук: до 100 символів.');let rows;
   const query='%'+text.replace(/[\s()+-]/g,'')+'%';
   if(s.target==='orders'){rows=await all(this.db,"SELECT id,total,customer FROM orders WHERE CAST(id AS TEXT)=? OR replace(replace(replace(json_extract(customer,'$.phone'),' ',''),'+',''),'-','') LIKE ? OR replace(replace(replace(json_extract(customer,'$.buyer_phone'),' ',''),'+',''),'-','') LIKE ? OR json_extract(customer,'$.name') LIKE ? ORDER BY id DESC LIMIT 20",[text.replace(/^№/,''),query,query,'%'+text+'%']);await this.shop.reset(this.uid);return this.send('<b>Результати пошуку</b>\n'+(rows.length?'Оберіть замовлення.':'Нічого не знайдено.'),kb(...rows.map(o=>[btn('№'+o.id+' · '+trimName(JSON.parse(o.customer).name,32)+' · '+money(o.total),'order:'+o.id)]),this.back('am:orders')));}
   rows=await all(this.db,"SELECT user_id,full_name,phone FROM customers WHERE replace(phone,'+','') LIKE ? OR full_name LIKE ? ORDER BY user_id DESC LIMIT 20",[query,'%'+text+'%']);await this.shop.reset(this.uid);return this.send('<b>Знайдені покупці</b>\n'+(rows.length?'Оберіть профіль.':'Нічого не знайдено.'),kb(...rows.map(p=>[btn(trimName(p.full_name||p.phone),'am:customer:'+p.user_id)]),this.back('am:customers')));
  }
  if(s.kind==='upload'){
   const asset=m.photo?.length?{file_id:m.photo.at(-1).file_id,kind:'photo'}:m.document&&['image/png','image/jpeg','image/webp'].includes(m.document.mime_type)?{file_id:m.document.file_id,kind:'document'}:null;if(!asset)throw new ShopError('Надішліть фото або файл PNG/JPEG/WebP.');
   return this.preview(s,asset,'Зберегти надіслане зображення?');
  }
  if(s.kind==='clone_name'){if(!text||text.length>600)throw new ShopError('Назва товару: 1–600 символів.');return this.prompt('clone_price',{template:s.template,name:text},'Ціна нової моделі в гривнях? Лише ціле число.');}
  if(s.kind==='clone_price'){const price=number(text);if(price<1)throw new ShopError('Ціна має бути більшою за нуль.');const p={...structuredClone(this.productData(s.template)),id:'p'+randomToken().slice(0,10),name:s.name,price_uah:price,active:false,photo:'',photo_confirmed:false,measurements:[],initial_stock:0};return this.preview({...s,kind:'clone'},p,p.name+'\n'+money(price)+'\nМодель буде прихованою. Кольори, розміри й опис успадковуються; фото, заміри й залишки потрібно додати.');}
  if(s.kind==='product'){let value=text;if(s.field==='price_uah'){value=number(text);if(value<1)throw new ShopError('Ціна має бути більшою за нуль.');}if(s.field==='measurements')value=text==='-'?[]:text.split('\n').map(x=>x.trim()).filter(Boolean);const p={...this.productData(s.pid),[s.field]:value};validateCatalog({currency:'UAH',categories:this.shop.categories,products:[p]});return this.preview(s,value,p.name+'\n'+FIELD_NAMES[s.field]+': '+(Array.isArray(value)?value.join('\n')||'не внесені':value));}
  if(s.kind==='stock'){if(!/^-?\d+$/.test(text))throw new ShopError('Залишок: −1 або ціле число від 0 до 100000.');const value=Number(text);if(!Number.isSafeInteger(value)||value< -1||value>100000)throw new ShopError('Залишок: −1 або число 0–100000.');return this.preview(s,value,s.variant+'\nНовий вільний залишок: '+(value===-1?'під замовлення':value));}
  if(s.kind==='setting')return this.preview(s,text,STORE_FIELDS[s.field]+'\n'+text);
  if(s.kind==='expense_amount'){const amount=pennies(text.replace(',','.'));return this.prompt('expense_note',{amount,category:s.category,token:s.token},'Короткий опис витрати? До 300 символів.');}
  if(s.kind==='expense_note'){if(!text||text.length>300)throw new ShopError('Опис витрати: 1–300 символів.');return this.preview({...s,kind:'expense',mode:this.shop.store.mode},text,COSTS[s.category]+'\n'+cash(s.amount)+'\n'+text+'\nРежим: '+this.shop.store.mode);}
  if(s.kind==='refund_order'){const oid=number(text),o=await this.shop.order(oid);if(!o)throw new ShopError('Замовлення не знайдено.');const b=await balances(this.shop,oid);if(b.received<=b.refunded)throw new ShopError('У журналі немає суми для повернення.');return this.prompt('refund_amount',{order_id:oid,token:s.token},'Замовлення №'+oid+'\nОтримано мінус повернення: '+cash(b.received-b.refunded)+'\nСкільки гривень фактично вже повернуто?');}
  if(s.kind==='refund_amount'){const amount=pennies(text.replace(',','.'));return this.preview({...s,kind:'refund'},amount,'Записати фактичне повернення '+cash(amount)+' за №'+s.order_id+'?\nЦе запис у журнал, без банківського переказу.');}
  throw new ShopError('Оберіть дію в кабінеті адміністратора.');
 }
 async apply(token){
  this.guard();const s=await this.shop.session(this.uid);if(s.step!=='am_confirm'||s.token!==token)throw new ShopError('Ця зміна вже оброблена або скасована.');
  if(s.kind==='clone'){await this.createProduct(s.value);s.pid=s.value.id;}
  else if(s.kind==='product')await this.updateProduct(s.pid,s.field,s.value,s.expected);
  else if(s.kind==='stock'){const r=await run(this.db,'UPDATE stock SET quantity=? WHERE variant=? AND quantity=?',[s.value,s.variant,s.expected]);if(r.meta.changes!==1)throw new ShopError('Залишок змінився після відкриття. Перевірте склад і повторіть дію.');}
  else if(s.kind==='setting')await this.updateSetting(s.field,s.value,s.expected);
  else if(s.kind==='visibility')await this.updateProduct(s.pid,'active',s.value,s.expected);
  else if(s.kind==='mode')await this.updateSetting(s.field,s.value,s.expected);
  else if(s.kind==='upload'){if(!/^product:|^size:|^(welcome|packaging|sizeguide)$/.test(s.key))throw new ShopError('Зображення не знайдено.');await run(this.db,'INSERT INTO assets VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET file_id=excluded.file_id,kind=excluded.kind',[s.key,s.value.file_id,s.value.kind]);}
  else if(s.kind==='expense'){if(s.mode!==this.shop.store.mode)throw new ShopError('Режим магазину змінився. Додайте витрату ще раз.');await expense(this.shop,{amount:s.amount,category:s.category,note:s.value,reference:'admin-expense:'+s.token});}
  else if(s.kind==='refund')await recordRefund(this.shop,s.order_id,s.value,'admin-refund:'+s.token);
  else if(s.kind==='campaignstop')await this.db.batch([stmt(this.db,"UPDATE campaigns SET state='cancelled' WHERE id=? AND state IN('draft','queued')",[s.value]),stmt(this.db,"UPDATE campaign_deliveries SET state='skipped',lock_until=0 WHERE campaign_id=? AND state='pending'",[s.value])]);
  else throw new ShopError('Дію не знайдено.');
  await this.shop.reset(this.uid);return this.send('Збережено.',kb([btn('Продовжити керування','am:home')],...(s.pid?[[btn('До товару','am:product:'+s.pid)]]:[])));
 }
 async callback(parts){
  this.guard();const [action,...p]=parts;if(action!=='apply')await this.shop.reset(this.uid);
  if(action==='home'||!action)return this.dashboard();if(action==='orders')return this.orders(p[0]||'all',p[1]||0,p[2]||'live');if(action==='orderfilters')return this.orderFilters();
  if(action==='catalog')return this.catalogue(p[0]||'catalog',p[1]||0);if(action==='product')return this.product(p[0]);if(action==='stock')return this.stock(p[0],p[1]||0);
  if(action==='customers')return this.customers(p[0]||0);if(action==='customer')return this.customer(p[0]);if(action==='customerorders')return this.customerOrders(p[0],p[1]||0);
  if(action==='finance')return this.finance(p[0]||30);if(action==='campaigns')return this.campaigns(p[0]||0);if(action==='campaign')return this.campaign(p[0]);if(action==='settings')return this.settings();if(action==='exports')return this.exports();if(action==='export')return this.file(p[0]);
  if(action==='shop'){await this.shop.reset(this.uid);return this.bot.home();}
  if(action==='web'){const url=this.panelURL();return this.send('Вебкабінет для таблиць, графіків і повних налаштувань. Для входу потрібен ваш SETUP_KEY.',kb(...(url?[[{text:'Відкрити вебкабінет',url}]]:[]),this.back()));}
  if(action==='search'){if(!['orders','customers'].includes(p[0]))throw new ShopError('Оберіть пошук.');return this.prompt('search',{target:p[0]},p[0]==='orders'?'Номер замовлення, телефон або ім’я одержувача?':'Телефон або ім’я покупця?');}
  if(action==='new'){this.productData(p[0]);return this.prompt('clone_name',{template:p[0]},'Назва нової моделі? Після створення вона буде прихованою.');}
  if(action==='edit'){if(!Object.hasOwn(FIELD_NAMES,p[1]))throw new ShopError('Поле недоступне.');this.productData(p[0]);const r=await first(this.db,'SELECT * FROM products WHERE id=?',[p[0]]);return this.prompt('product',{pid:p[0],field:p[1],expected:JSON.stringify([r.data,r.price,r.active])},'Нове значення: '+FIELD_NAMES[p[1]]+(p[1]==='measurements'?'\nОдин розмір у рядку. «-» — очистити.':''));}
  if(action==='visibility'){const r=await first(this.db,'SELECT * FROM products WHERE id=?',[p[0]]);if(!r)throw new ShopError('Товар не знайдено.');return this.preview({kind:'visibility',pid:p[0],expected:JSON.stringify([r.data,r.price,r.active]),token:randomToken()},!r.active,(r.active?'Приховати':'Показати')+' '+this.productData(p[0]).name+'?');}
  if(action==='stockset'){this.productData(p[0]);const r=await first(this.db,'SELECT * FROM stock WHERE variant LIKE ? ORDER BY variant LIMIT 1 OFFSET ?',[p[0]+':%',number(p[1],3000)]);if(!r)throw new ShopError('Варіант не знайдено.');const product=this.productData(p[0]),a=r.variant.split(':'),color=product.colors.find(c=>c.id===a[1])?.name||a[1];return this.prompt('stock',{pid:p[0],variant:r.variant,expected:r.quantity},product.name+'\n'+color+' · '+a[2]+(a[3]?' / '+a[3]:'')+'\nПоточний залишок: '+r.quantity+'\nВведіть нову вільну кількість. −1 — під замовлення, 0 — немає.');}
  if(action==='upload'){this.productData(p[0]);if(!['photo','size'].includes(p[1]))throw new ShopError('Оберіть тип зображення.');return this.prompt('upload',{pid:p[0],key:(p[1]==='size'?'size:':'product:')+p[0]},'Надішліть '+(p[1]==='size'?'розмірну сітку':'фото товару')+' одним фото або файлом PNG/JPEG/WebP. Підпис не потрібен.');}
  if(action==='asset'){if(!['welcome','packaging','sizeguide'].includes(p[0]))throw new ShopError('Оберіть зображення.');return this.prompt('upload',{key:p[0]},'Надішліть нове зображення одним фото або файлом PNG/JPEG/WebP.');}
  if(action==='setting'){if(!Object.hasOwn(STORE_FIELDS,p[0]))throw new ShopError('Поле недоступне.');return this.prompt('setting',{field:p[0],expected:this.shop.store.revision},'<b>'+STORE_FIELDS[p[0]]+'</b>\nЗараз:\n'+esc(this.shop.store[p[0]]||'не вказано')+'\n\nНадішліть новий текст.');}
  if(action==='modes')return this.send('<b>Режим продажів</b>\nЗараз: '+this.shop.store.mode+' / '+this.shop.store.sales_mode,kb([btn('Тестовий режим','am:mode:mode:demo'),btn('Реальні продажі','am:mode:mode:live')],[btn('Передзамовлення','am:mode:sales_mode:preorder'),btn('Готові товари','am:mode:sales_mode:ready')],this.back('am:settings')));
  if(action==='mode'){if(!(p[0]==='mode'&&['live','demo'].includes(p[1])||p[0]==='sales_mode'&&['ready','preorder'].includes(p[1])))throw new ShopError('Оберіть режим зі списку.');return this.preview({kind:'mode',field:p[0],expected:this.shop.store.revision,token:randomToken()},p[1],'Змінити '+p[0]+' на '+p[1]+'? Перевірки готовності live залишаються чинними.');}
  if(action==='pause')return this.preview({kind:'mode',field:'orders_paused',expected:this.shop.store.revision,token:randomToken()},!this.shop.store.orders_paused,this.shop.store.orders_paused?'Відновити приймання замовлень?':'Призупинити нові замовлення? Уже створені залишаться в роботі.');
  if(action==='access')return this.send('Права адміністратора задаються через ADMIN_IDS або захищену вебпанель. Токени Telegram, monobank і ключі доступу тут не показуються й не редагуються.',kb([btn('Вебкабінет','am:web')],this.back('am:settings')));
  if(action==='expense')return this.send('Категорія витрати?',kb(...Object.entries(COSTS).map(([k,v])=>[btn(v,'am:expensecategory:'+k)]),this.back('am:finance')));
  if(action==='expensecategory'){if(!Object.hasOwn(COSTS,p[0]))throw new ShopError('Оберіть категорію.');return this.prompt('expense_amount',{category:p[0]},'Сума витрати в гривнях? Наприклад, 450 або 450,50.');}
  if(action==='refundfor'){const id=number(p[0]),o=await this.shop.order(id);if(!o)throw new ShopError('Замовлення не знайдено.');const b=await balances(this.shop,id);if(b.received<=b.refunded)throw new ShopError('У журналі немає коштів для повернення.');return this.prompt('refund_amount',{order_id:id},'Замовлення №'+id+'\nДоступно для запису повернення: '+cash(b.received-b.refunded)+'\nСкільки гривень фактично вже повернуто?');}
  if(action==='refund')return this.prompt('refund_order',{},'Номер замовлення для запису фактично повернутих коштів?');
  if(action==='campaignstop'){const c=await first(this.db,'SELECT id FROM campaigns WHERE id=?',[number(p[0])]);if(!c)throw new ShopError('Розсилку не знайдено.');return this.preview({kind:'campaignstop',token:randomToken()},c.id,'Зупинити розсилку №'+c.id+'? Уже відправлені повідомлення не відкликаються.');}
  if(action==='apply')return this.apply(p[0]);throw new ShopError('Відкрийте кабінет адміністратора ще раз.');
 }
 async message(m,raw,head){
  if(head==='/admin'){this.guard();await this.dashboard();return true;}if(!this.allowed())return false;
  const routes={'Адмін-панель':'home','Кабінет адміністратора':'home','Замовлення':'orders','Товари':'catalog','Склад':'catalog:stock','Покупці':'customers','Фінанси':'finance','Розсилки':'campaigns','Налаштування':'settings','Експорт':'exports','Переглянути магазин':'shop','Вебкабінет':'web'};
  if(head==='/start'||raw==='Головне меню'){await this.dashboard();return true;}
  if(Object.hasOwn(routes,raw)){await this.shop.reset(this.uid);await this.callback(routes[raw].split(':'));return true;}
  const s=await this.shop.session(this.uid);if(!['am_input','am_confirm'].includes(s.step))return false;
  if(head==='/cancel'||raw==='Скасувати оформлення'){await this.dashboard();return true;}if(head.startsWith('/'))return false;
  if(s.step==='am_confirm'){await this.send('Збережіть зміну кнопкою або скасуйте її.',kb([btn('Зберегти','am:apply:'+s.token)],[btn('Скасувати','am:home')]));return true;}
  await this.input(s,raw,m);return true;
 }
}
