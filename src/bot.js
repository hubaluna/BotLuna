import {BotFeatures,FEATURE_ACTIONS} from './bot-features.js';
import {balances,recordReceipt} from './commerce.js';
import { CONCEPT_PHOTOS,PREORDER_NOTICE,onlineReady,ShopError,STATUS,NEXT,DELIVERY,PAYMENTS,HOME,esc,money,phone,randomToken,adminIds,targets,stmt,first,all,run,epoch,stamp,telegram,TelegramError,btn,kb,send,media,publicError } from './core.js';

export function receipt(o,details=false){
 const lines=[o.id?'<b>FORMULOVE · №'+String(o.id).padStart(6,'0')+'</b>':'<b>Ваше замовлення</b>'];
 if(o.mode==='demo')lines.push('Тестове замовлення — без оплати.');
 if(o.id)lines.push(STATUS[o.status]);
 for(const i of o.items)lines.push('\n'+esc(i.name)+'\n'+esc(i.label)+' · '+i.quantity+' × '+money(i.unit_price));
 lines.push('\n'+esc(o.package_name)+': '+money(o.packaging_total),'<b>Разом: '+money(o.total)+'</b>','Доставка оплачується окремо.');
 if(o.customer?.payment==='cod')lines.push('Можлива комісія за післяплату.');
 if(details){const c=o.customer;lines.push('\n'+(c.recipient_mode==='other'?'Інший одержувач: ':'')+esc(c.name)+' · '+esc(c.phone),esc(c.city)+', '+DELIVERY[c.delivery].toLowerCase()+': '+esc(c.branch),'Оплата: '+PAYMENTS[c.payment]);if(c.buyer_phone&&c.buyer_phone!==c.phone)lines.push('Контакт покупця: '+esc(c.buyer_phone));if(c.comment)lines.push('Побажання: '+esc(c.comment));}
 if(o.customer?.sale_type==='preorder')lines.push('\n'+esc(o.customer.preorder_notice||PREORDER_NOTICE));
 if(o.tracking)lines.push('\nТТН: <code>'+esc(o.tracking)+'</code>');return lines.join('\n');
}

const PREVIOUS={name:'recipient',phone:'name',city:'phone',delivery:'city',branch:'delivery',package:'branch',payment:'package',comment:'payment',consent:'comment',review:'consent'};
const shortName=p=>p.name.length>48?p.name.slice(0,45)+'…':p.name;

export class Bot {
 constructor(shop,uid,updateId){this.shop=shop;this.db=shop.db;this.env=shop.env;this.uid=uid;this.updateId=updateId;this.features=new BotFeatures(this);}
 get store(){return this.shop.store;}
 send(text,markup){return send(this.env,this.uid,text,markup);}
 back(previous=true){return kb(...(previous?[[btn('Назад','checkout_back')]]:[]),[btn('Скасувати','checkout_cancel')]);}
 contact(){return this.store.support_url?{text:'Написати нам',url:this.store.support_url}:btn('Допомога','info');}
 support(){return kb([this.contact()],[btn('Показати все','all:0'),btn('Кошик','cart')]);}
 image(p){
  const asset=this.shop.assets['product:'+p.id]||(p.photo?{kind:'photo',file_id:p.photo}:null);
  if(asset)return {asset,color:''};
  const c=Object.hasOwn(CONCEPT_PHOTOS,p.id)?CONCEPT_PHOTOS[p.id]:null;
  return c&&(this.store.mode==='demo'||this.store.sales_mode==='preorder')&&this.env.PUBLIC_BASE_URL?{asset:{kind:'photo',file_id:new URL('/products/'+c.file,this.env.PUBLIC_BASE_URL).href},color:c.color}:{asset:null,color:''};
 }
 async home(){
  await this.shop.reset(this.uid);
  const text='<b>FORMULOVE</b>\n\nОдяг з вишивкою для фанатів Формули 1.\nПерегляньте всі моделі або оберіть категорію.'+(this.store.mode==='demo'?'\n\nТестовий режим — замовлення без оплати.':'');
  if(!await media(this.env,this.uid,this.shop.assets.welcome,text,HOME))await this.send(text,HOME);
 }
 async catalog(){
  const rows=this.shop.categories.filter(c=>Object.values(this.shop.products).some(p=>p.active&&p.category===c.id)).map(c=>[btn(c.name,'cat:'+c.id)]);
  await this.send('<b>Каталог</b>',kb([btn('Показати все','all:0')],...rows,[btn('Кошик','cart'),btn('Допомога','info')]));
 }
 async gallery(offset=0,category=''){
  const products=Object.values(this.shop.products).filter(p=>p.active&&(!category||p.category===category));
  if(!products.length)return this.send('Каталог оновлюється. Напишіть нам — підкажемо, що можна замовити.',this.support());
  if(!Number.isInteger(offset)||offset<0||offset>=products.length)throw new ShopError('Відкрийте каталог ще раз.');
  const page=products.slice(offset,offset+10),photos=[],documents=[];
  page.forEach((p,i)=>{const {asset}=this.image(p);if(!asset)return;const item={type:asset.kind==='document'?'document':'photo',media:asset.file_id,caption:(offset+i+1)+'. '+p.name+'\n'+money(p.price_uah)+(p.pair?' за дві речі':'')};(item.type==='document'?documents:photos).push(item);});
  let failed=false;
  try{
   for(const group of [photos,documents]){
    if(group.length>=2)await telegram(this.env,'sendMediaGroup',{chat_id:this.uid,media:group});
    else if(group.length===1)failed=!await media(this.env,this.uid,{kind:group[0].type,file_id:group[0].media},group[0].caption)||failed;
   }
  }catch(error){if(error.code===403)throw error;failed=true;}
  const rows=page.map((p,i)=>[btn((offset+i+1)+'. '+shortName(p),'product:'+p.id)]);
  if(failed)rows.unshift([btn('Спробувати завантажити фото ще раз','all:'+offset+(category?':'+category:''))]);
  const navigation=[];if(offset>0)navigation.push(btn('Попередні','all:'+Math.max(0,offset-10)+(category?':'+category:'')));if(offset+10<products.length)navigation.push(btn('Показати ще','all:'+(offset+10)+(category?':'+category:'')));if(navigation.length)rows.push(navigation);
  rows.push([btn('Категорії','catalog'),btn('Кошик','cart')]);
  await this.send((failed?'Фото не завантажилися. Можна повторити або обрати товар нижче.\n\n':'')+'<b>Оберіть модель</b>',kb(...rows));
 }
 async category(id){const c=this.shop.categories.find(c=>c.id===id);if(!c)throw new ShopError('Відкрийте категорію з каталогу.');await this.send('<b>'+esc(c.name)+'</b>',kb([btn('Показати фото','all:0:'+id)],...Object.values(this.shop.products).filter(p=>p.active&&p.category===id).map(p=>[btn(shortName(p)+' · '+money(p.price_uah),'product:'+p.id)]),[btn('Усі моделі','all:0'),btn('Каталог','catalog')]));}
 async product(id){
  const p=this.shop.get(id),image=this.image(p),rows=[];let prompt='Оберіть колір:';
  if(p.colors.length===1&&p.sizes.length===1&&!p.pair){const variant=this.shop.variant(id,p.colors[0].id,p.sizes[0]),stock=await first(this.db,'SELECT quantity FROM stock WHERE variant=?',[variant]);rows.push([btn(stock?.quantity?'Додати в кошик':'Немає в наявності',stock?.quantity?'add:'+id+':'+p.colors[0].id+':'+p.sizes[0]:'unavailable')]);prompt='';}
  else if(p.colors.length===1){rows.push([btn('Обрати розмір','color:'+id+':'+p.colors[0].id)]);prompt='';}
  else rows.push(...p.colors.map(c=>[btn(c.name,'color:'+id+':'+c.id)]));
  rows.push([btn('Розмірна сітка','measure:'+id),this.contact()],[btn('Усі моделі','all:0'),btn('Кошик','cart')]);
  const specs=p.photo_confirmed?'\n\n'+esc(p.materials)+'\n'+esc(p.embroidery):'';
  const fulfillment=this.store.sales_mode==='preorder'?'Виготовлення під замовлення.':this.store.dispatch_text.slice(0,300);
  const text='<b>'+esc(p.name)+'</b>\n<b>'+money(p.price_uah)+'</b>'+(p.pair?' за дві речі':'')+(image.color?' · '+esc(image.color):'')+'\n\n'+esc(p.description)+specs+'\n\n'+esc(fulfillment)+(this.store.mode==='demo'?'\nТестове замовлення — без оплати.':'')+(prompt?'\n\n'+prompt:'');
  if(image.asset&&text.length<=1024&&await media(this.env,this.uid,image.asset,text,kb(...rows)))return;
  if(image.asset&&text.length>1024)await media(this.env,this.uid,image.asset,p.name+' · '+money(p.price_uah));
  await this.send(text,kb(...rows));
 }
 async sizes(id,color,size1=''){
  const p=this.shop.get(id);if(!p.colors.some(c=>c.id===color)||(size1&&!p.sizes.includes(size1)))throw new ShopError('Оберіть колір і розмір ще раз.');
  const stock=Object.fromEntries((await all(this.db,'SELECT variant,quantity FROM stock WHERE variant LIKE ?',[id+':%'])).map(r=>[r.variant,r.quantity]));const buttons=[];
  for(const size of p.sizes){let data,key;if(size1){key=this.shop.variant(id,color,size1,size);data='add2:'+id+':'+color+':'+size1+':'+size;}else if(p.pair)data='first:'+id+':'+color+':'+size;else{key=this.shop.variant(id,color,size);data='add:'+id+':'+color+':'+size;}
   const available=key?!!stock[key]:Object.entries(stock).some(([k,q])=>k.startsWith([id,color,size].join(':')+':')&&q!==0);buttons.push(btn(size+(available?'':' — немає'),available?data:'unavailable'));}
  const rows=[];for(let i=0;i<buttons.length;i+=3)rows.push(buttons.slice(i,i+3));rows.push([btn('Розмірна сітка','measure:'+id),btn('Назад','product:'+id)]);
  await this.send('<b>'+esc(p.name)+'</b>\n'+(size1?'Перша річ: '+esc(size1)+'\nРозмір другої речі:':p.pair?'Розмір першої речі:':'Оберіть розмір:'),kb(...rows));
 }
 async measures(id){return this.features.measures(id);}
 async cart(){
  const rows=await all(this.db,'SELECT c.*,s.quantity AS available FROM carts c LEFT JOIN stock s ON s.variant=c.variant WHERE user_id=? ORDER BY c.id',[this.uid]);if(!rows.length)return this.send('Кошик порожній.',kb([btn('Показати все','all:0')]));
  const lines=['<b>Кошик</b>'],buttons=[];let total=0;
  for(const [index,r] of rows.entries()){try{const {p,label}=this.shop.parseVariant(r.variant);total+=r.quantity*p.price_uah;lines.push('\n'+(index+1)+'. '+esc(p.name)+'\n'+esc(label)+' · '+r.quantity+' × '+money(p.price_uah)+'\n'+(r.available===-1?'Під замовлення':r.available<r.quantity?'Не вистачає потрібної кількості':'У наявності'));}catch{lines.push('\n'+(index+1)+'. Товар недоступний — приберіть його.');}buttons.push([btn('−','qty:'+r.id+':-1'),btn((index+1)+' · '+r.quantity+' шт.','noop'),btn('+','qty:'+r.id+':1'),btn('Прибрати','remove:'+r.id)]);}
  lines.push('\n<b>Товари: '+money(total)+'</b>\nДоставка оплачується окремо. Пакування оберете далі.');buttons.push([btn('Оформити замовлення','checkout')],[btn('Обрати ще','all:0'),btn('Очистити кошик','clearask')]);await this.send(lines.join('\n'),kb(...buttons));
 }
 async ask(step){
  if(step==='recipient')return this.features.recipientPrompt();if(step==='consent')return this.consentText();const s=await this.shop.session(this.uid),back=this.back();
  const texts={name:'Ім’я та прізвище одержувача?',phone:'Номер телефону одержувача?',city:'Місто або населений пункт?',delivery:'Куди доставити?',branch:s.customer?.delivery==='locker'?'Номер або адреса поштомата?':'Номер або адреса відділення Нової пошти?',package:'Оберіть пакування:',payment:'Як зручно оплатити?',comment:'Є побажання до замовлення?'};
  let markup=back;
  if(step==='phone'&&s.customer?.recipient_mode!=='other')markup={keyboard:[[{text:'Поділитися номером',request_contact:true}],[{text:'Назад'},{text:'Скасувати оформлення'}]],resize_keyboard:true,one_time_keyboard:true};
  if(step==='delivery')markup=kb(...Object.entries(DELIVERY).map(([k,v])=>[btn(v,'delivery:'+k)]),...back.inline_keyboard);
  if(step==='package')markup=kb(...this.store.packages.map(p=>[btn(p.name+' · '+money(p.price_uah),'package:'+p.id)]),[btn('Про пакування','info:packaging')],...back.inline_keyboard);
  if(step==='payment')markup=kb(...this.shop.paymentMethods().map(k=>[btn(PAYMENTS[k],'payment:'+k)]),[btn('Про оплату','info:payment')],...back.inline_keyboard);
  if(step==='comment')markup=kb([btn('Пропустити','skipcomment')],...back.inline_keyboard);
  return this.send(texts[step]||'Продовжіть оформлення.',markup);
 }
 async move(session,step){session.step=step;await this.shop.saveSession(this.uid,session,this.updateId);return this.ask(step);}
 async checkout(){return this.features.checkout();}
 async checkoutBack(){const s=await this.shop.session(this.uid);if(!s.step)return this.cart();if(s.last_update===this.updateId)return this.ask(s.step);const previous=s.step==='city'&&s.customer?.recipient_mode==='self'?'recipient':PREVIOUS[s.step];if(!previous)return this.ask('name');return this.move(s,previous);}
 async consentText(){await this.send('Для замовлення використаємо ваше ім’я, телефон і дані доставки. Погоджуєтеся?',kb([btn('Погоджуюсь','consent')],[btn('Про обробку даних','info:privacy'),btn('Умови покупки','info:terms')],...this.back().inline_keyboard));}
 async review(){
  const s=await this.shop.session(this.uid),q=await this.shop.quote(this.uid,s.customer.package);s.step='review';s.token=randomToken();s.fingerprint=q.fingerprint;await this.shop.saveSession(this.uid,s,this.updateId);
  const o={id:0,mode:this.store.mode,status:'new',items:q.items,customer:{...s.customer,sale_type:this.store.sales_mode||'ready',preorder_notice:this.store.sales_mode==='preorder'?PREORDER_NOTICE:''},package_name:q.package_name,goods_total:q.goods,packaging_total:q.packaging,total:q.total};
  await this.send(receipt(o,true)+'\n\nПісля підтвердження напишемо вам, щоб погодити деталі.',kb([btn(this.store.mode==='demo'?'Підтвердити тестове замовлення':'Підтвердити замовлення','place:'+s.token)],[btn('Назад','checkout_back'),btn('Змінити дані','checkout')],[btn('Скасувати','checkout_cancel')]));
 }
 async text(message){
  const s=await this.shop.session(this.uid);if(s.last_update===this.updateId)return;const c=s.customer||{};const text=String(message.text||'').trim();
  if(!s.step)return this.send('Перегляньте каталог або напишіть нам.',this.support());
  if(s.step==='name'){if(text.split(/\s+/).length<2||text.length<3||text.length>100)throw new ShopError('Напишіть ім’я та прізвище одержувача.');c.name=text;return this.features.fromName({...s,customer:c});}
  if(s.step==='phone'){let raw=text;if(message.contact){if(message.contact.user_id!==this.uid)throw new ShopError('Номер іншого одержувача введіть вручну.');raw=message.contact.phone_number;}c.phone=phone(raw);return this.move({...s,customer:c},'city');}
  if(s.step==='city'){if(text.length<2||text.length>100)throw new ShopError('Напишіть назву населеного пункту.');c.city=text;return this.move({...s,customer:c},'delivery');}
  if(s.step==='branch'){if(text.length<1||text.length>160)throw new ShopError('Вкажіть номер або адресу для доставки.');c.branch=text;return this.move({...s,customer:c},'package');}
  if(s.step==='comment'){if(text.length>500)throw new ShopError('Скоротіть побажання до 500 символів.');c.comment=text==='Пропустити'?'':text;return this.move({...s,customer:c},'consent');}
  return this.send('Оберіть варіант кнопкою нижче.',this.back());
 }
 async orders(admin=false){const rows=admin?await all(this.db,'SELECT id,status,total,mode FROM orders ORDER BY id DESC LIMIT 15'):await all(this.db,'SELECT id,status,total,mode FROM orders WHERE user_id=? ORDER BY id DESC LIMIT 10',[this.uid]);if(!rows.length)return this.send('Замовлень поки немає.',this.support());await this.send(admin?'<b>Замовлення магазину</b>':'<b>Мої замовлення</b>',kb(...rows.map(o=>[btn('№'+String(o.id).padStart(6,'0')+' · '+STATUS[o.status]+' · '+money(o.total)+(o.mode==='demo'?' · тест':''),'order:'+o.id)]),[btn('Головна','home')]));}
 async viewOrder(id){
  const o=await this.shop.order(id),admin=adminIds(this.env).includes(this.uid);if(!o||(!admin&&o.user_id!==this.uid))throw new ShopError('Замовлення не знайдено.');const rows=[],b=await balances(this.shop,id);
  if(admin){for(const status of NEXT[o.status])if(!['shipped','paid'].includes(status))rows.push([btn(STATUS[status],'statusask:'+id+':'+status)]);
   if(['confirmed','paid','processing','shipped'].includes(o.status))rows.unshift([btn(o.tracking?'Змінити ТТН':'Додати ТТН','track:'+id)]);
   if(!['new','cancelled'].includes(o.status)&&b.received<o.total*100)rows.push([btn('Записати отриману оплату','cashask:'+id)]);
  }else if(o.status==='new')rows.push([btn('Скасувати замовлення','cancelask:'+id)]);
  if(o.mode==='live'&&onlineReady(this.env)&&['confirmed','processing'].includes(o.status)&&b.received===0&&o.user_id===this.uid)rows.push([btn('Оплатити карткою / гаманцем','pay:'+id)]);
  const existingInvoice=await first(this.db,'SELECT invoice_id FROM payment_invoices WHERE order_id=?',[id]);if(existingInvoice?.invoice_id)rows.push([btn('Перевірити оплату','paycheck:'+id)]);
  rows.push([btn(admin?'Усі замовлення':'Мої замовлення',admin?'adminorders':'orders'),this.contact()]);
  await this.send(receipt(o,true)+(b.received?'\n\nЗаписані оплати: '+money(b.received/100)+(b.refunded?' · повернуто '+money(b.refunded/100):''):''),kb(...rows));
 }
 async info(topic=''){
  if(!topic)return this.send('<b>Допомога</b>',kb([this.contact()],[btn('Доставка','info:delivery'),btn('Оплата','info:payment')],[btn('Обмін і повернення','info:returns')],[btn('Інші питання','info:more')],[btn('Показати все','all:0'),btn('Кошик','cart')]));
  if(topic==='more')return this.send('<b>Інші питання</b>',kb(...[['about','Про FORMULOVE'],['care','Догляд'],['packaging','Пакування'],['privacy','Ваші дані'],['terms','Умови покупки'],['faq','Питання й відповіді']].map(([k,v])=>[btn(v,'info:'+k)]),[btn('Назад','info')]));
  const texts={about:'FORMULOVE — український бренд одягу з вишивкою для фанатів Формули 1. Власні дизайни для щодня. Незалежний бренд, не офіційний мерч і не партнер Formula 1 або команд.',delivery:this.store.delivery_text+'\n\n'+this.store.dispatch_text,payment:this.store.payment_text,returns:this.store.returns_text,care:this.store.care_text,privacy:this.store.privacy_text,packaging:this.store.packages.map(p=>p.name+' · '+money(p.price_uah)+'\n'+p.description).join('\n\n'),terms:this.store.seller_name+'\n'+this.store.seller_details+'\n\n'+this.store.payment_text+'\n\n'+this.store.delivery_text+'\n\n'+this.store.returns_text,faq:'Розмір\nУ картці товару є кнопка «Розмірна сітка». Якщо потрібна допомога, напишіть нам.\n\nПарні комплекти\nРозмір кожної речі обирається окремо. Ціна вказана за дві речі.\n\nВідстеження\nТТН з’явиться в «Моїх замовленнях» після відправлення.\n\nЗміни\nНове замовлення можна скасувати й оформити заново. Якщо його вже погоджено, напишіть нам.'};
  if(!texts[topic])throw new ShopError('Оберіть розділ у меню допомоги.');if(topic==='packaging')await media(this.env,this.uid,this.shop.assets.packaging,'Пакування FORMULOVE');
  const text=texts[topic];for(let at=0;at<text.length;at+=3500)await telegram(this.env,'sendMessage',{chat_id:this.uid,text:text.slice(at,at+3500),reply_markup:at+3500>=text.length?kb([this.contact()],[btn('До допомоги','info'),btn('Каталог','catalog')]):kb(),link_preview_options:{is_disabled:true}});
 }
 async callback(data){
  const [action,...p]=String(data).split(':');
  if(FEATURE_ACTIONS.has(action))return this.features.callback(action,p);
  if(action==='home')return this.home();if(action==='catalog'){await this.shop.reset(this.uid);return this.catalog();}if(action==='all'){await this.shop.reset(this.uid);return this.gallery(p[0]?Number(p[0]):0,p[1]||'');}
  if(action==='cat')return this.category(p[0]);if(action==='product')return this.product(p[0]);if(action==='measure')return this.measures(p[0]);if(action==='color')return this.sizes(p[0],p[1]);
  if(action==='first'){if(!this.shop.get(p[0]).pair)throw new ShopError('Оберіть розмір товару.');return this.sizes(p[0],p[1],p[2]);}
  if(['add','add2'].includes(action)){const key=this.shop.variant(p[0],p[1],p[2],action==='add2'?p[3]:'');await this.shop.changeCart(this.uid,key,1,'u:'+this.updateId);await this.shop.reset(this.uid);return this.send('Додано в кошик.',kb([btn('До кошика','cart'),btn('Обрати ще','all:0')],[btn('Оформити замовлення','checkout')]));}
  if(action==='cart'){await this.shop.reset(this.uid);return this.cart();}
  if(action==='qty'||action==='remove'){const r=await first(this.db,'SELECT variant FROM carts WHERE id=? AND user_id=?',[Number(p[0]),this.uid]);if(!r)throw new ShopError('Цю позицію вже змінено. Відкрийте кошик ще раз.');const delta=action==='remove'?'remove':Number(p[1]);if(!['remove',1,-1].includes(delta))throw new ShopError('Оберіть кількість кнопками.');await this.shop.changeCart(this.uid,r.variant,delta,'u:'+this.updateId);await this.shop.reset(this.uid);return this.cart();}
  if(action==='clearask')return this.send('Очистити кошик?',kb([btn('Очистити','clear'),btn('Залишити','cart')]));if(action==='clear'){await run(this.db,'DELETE FROM carts WHERE user_id=?',[this.uid]);await this.shop.reset(this.uid);return this.cart();}
  if(action==='checkout')return this.checkout();if(action==='checkout_back')return this.checkoutBack();if(action==='checkout_cancel'){await this.shop.reset(this.uid);return this.send('Оформлення скасовано. Товари залишилися в кошику.',HOME);}
  if(['delivery','package','payment','skipcomment','consent'].includes(action)){
   const s=await this.shop.session(this.uid),expected={delivery:'delivery',package:'package',payment:'payment',skipcomment:'comment',consent:'consent'}[action];if(s.step!==expected)throw new ShopError('Цей крок уже пройдено. Продовжіть оформлення нижче.');const c=s.customer;
   if(action==='delivery'){if(!DELIVERY[p[0]])throw new ShopError('Оберіть спосіб доставки.');c.delivery=p[0];return this.move(s,'branch');}
   if(action==='package'){if(!this.store.packages.some(x=>x.id===p[0]))throw new ShopError('Оберіть пакування зі списку.');c.package=p[0];return this.move(s,'payment');}
   if(action==='payment'){if(!this.shop.paymentMethods().includes(p[0]))throw new ShopError('Оберіть доступний спосіб оплати.');c.payment=p[0];return this.move(s,'comment');}
   if(action==='skipcomment'){c.comment='';return this.move(s,'consent');}c.consent=true;await this.shop.saveSession(this.uid,s,this.updateId);return this.review();
  }
  if(action==='place'){const old=await first(this.db,'SELECT id FROM orders WHERE token=? AND user_id=?',[p[0],this.uid]);if(old)return this.viewOrder(old.id);const s=await this.shop.session(this.uid);if(s.step!=='review'||s.token!==p[0])throw new ShopError('Перевірте замовлення ще раз перед підтвердженням.');await this.shop.place(this.uid,s.token,s.customer,s.fingerprint);return;}
  if(action==='orders')return this.orders();if(action==='order')return this.viewOrder(Number(p[0]));
  if(action==='cancelask'){const o=await this.shop.order(Number(p[0]));if(!o||o.user_id!==this.uid||o.status!=='new')throw new ShopError('Для скасування напишіть нам.');return this.send('Скасувати замовлення №'+o.id+'?',kb([btn('Скасувати','canceldo:'+o.id),btn('Залишити','order:'+o.id)]));}
  if(action==='canceldo'){await this.shop.status(Number(p[0]),'cancelled',this.uid,{buyer:true});return this.viewOrder(Number(p[0]));}
  if(['statusask','status','adminorders'].includes(action)){
   if(!adminIds(this.env).includes(this.uid))throw new ShopError('Немає доступу.');if(action==='adminorders')return this.orders(true);const id=Number(p[0]),status=p[1];if(!STATUS[status])throw new ShopError('Оберіть статус зі списку.');
   if(action==='statusask')return this.send('Замовлення №'+id+' → '+STATUS[status]+'?'+(status==='cancelled'?'\nКошти, якщо були сплачені, повертаються окремо.':''),kb([btn('Підтвердити','status:'+id+':'+status),btn('Назад','order:'+id)]));if(status==='paid')await recordReceipt(this.shop,id,this.uid,'manual:'+id);else await this.shop.status(id,status,this.uid);return this.viewOrder(id);
  }
  if(action==='adminhelp'){if(!adminIds(this.env).includes(this.uid))throw new ShopError('Немає доступу.');return this.adminHelp(p[0]);}
  if(action==='info')return this.info(p[0]);if(action==='unavailable')throw new ShopError('Цього варіанта немає. Оберіть інший розмір або колір.');if(action!=='noop')throw new ShopError('Відкрийте меню командою /start.');
 }
 async adminHelp(topic='menu'){
  if(!adminIds(this.env).includes(this.uid))throw new ShopError('Немає доступу.');
  if(topic==='stats')return this.admin('/stats',{});if(topic==='export')return this.export();
  const menu=kb([btn('Замовлення','adminorders'),btn('Підсумки','adminhelp:stats')],[btn('Ціни й залишки','adminhelp:stock')],[btn('Зображення','adminhelp:photos'),btn('Експорт CSV','adminhelp:export')],[btn('Новини підписникам','campaignstart')],[btn('Команди','adminhelp:commands')]);
  const texts={menu:'<b>Керування FORMULOVE</b>',stock:'<b>Ціни й залишки</b>\n/price heart 1190 — змінити ціну\n/variants heart — варіанти товару\n/stock heart:black:M: 5 — залишок\n/show heart on або off — показати чи сховати\n\nПовний каталог редагується в панелі /setup.',photos:'<b>Зображення</b>\nНадішліть фото з підписом /photo heart. Замість heart — ID потрібного товару.\n\n/asset welcome — зображення на головній\n/asset packaging — пакування\n/size heart — сітка товару\n/asset sizeguide — загальна схема замірів\n\nФото або файл PNG/JPEG/WebP.',commands:'<b>Команди</b>\n/orders — усі замовлення\n/order 1 — відкрити замовлення\n/ship 1 ТТН — додати ТТН\n/stats — суми замовлень\n/export — вивантажити CSV'};
  return this.send(texts[topic]||texts.menu,menu);
 }
 async admin(text,message){
  if(!adminIds(this.env).includes(this.uid))throw new ShopError('Команда доступна лише власнику.');
  const [command,...rest]=text.split(' ');const arg=rest.join(' ').trim();
  if(command==='/admin')return this.adminHelp();
  if(command==='/order')return this.viewOrder(Number(arg));
  if(command==='/price'){const [pid,price]=arg.split(/\s+/),value=Number(price);const p=this.shop.get(pid);if(!Number.isInteger(value)||value<1||value>100000)throw new ShopError('Ціна — ціле число 1–100000 грн.');await run(this.db,'UPDATE products SET price=? WHERE id=?',[value,pid]);return this.send(esc(p.name)+': '+money(value));}
  if(command==='/show'){const [pid,flag]=arg.split(/\s+/);if(!this.shop.products[pid]||!['on','off'].includes(flag))throw new ShopError('Приклад: /show heart off');await run(this.db,'UPDATE products SET active=? WHERE id=?',[flag==='on'?1:0,pid]);return this.send(flag==='on'?'Товар показано в каталозі.':'Товар приховано.');}
  if(command==='/variants'){const p=this.shop.get(arg);const rows=await all(this.db,'SELECT variant,quantity FROM stock WHERE variant LIKE ? ORDER BY variant',[p.id+':%']);for(let i=0;i<rows.length;i+=25)await this.send('<b>Варіанти</b>\n'+rows.slice(i,i+25).map(r=>esc(r.variant)+' → '+(r.quantity===-1?'під замовлення':r.quantity)).join('\n'));return;}
  if(command==='/stock'){const at=arg.lastIndexOf(' '),variant=arg.slice(0,at),quantity=Number(arg.slice(at+1));this.shop.parseVariant(variant);if(at<0||!Number.isInteger(quantity)||quantity< -1||quantity>100000)throw new ShopError('Залишок: -1 або ціле число від 0 до 100000.');await run(this.db,'UPDATE stock SET quantity=? WHERE variant=?',[quantity,variant]);return this.send('Залишок оновлено.');}
  if(command==='/ship'){const [id,tracking]=arg.split(/\s+/);await this.shop.status(Number(id),'shipped',this.uid,{tracking});return this.viewOrder(Number(id));}
  if(command==='/stats')return this.features.stats();
  if(command==='/export')return this.export();
  if(command==='/photo'||command==='/size'||command==='/asset'){
   let key;if(command==='/photo'||command==='/size'){if(!this.shop.products[arg])throw new ShopError('Вкажіть ID товару, наприклад /photo heart');key=(command==='/size'?'size:':'product:')+arg;}else{if(!['welcome','packaging','sizeguide'].includes(arg))throw new ShopError('Приклад: /asset welcome або /asset packaging');key=arg;}
   const source=message.photo?.length?{file_id:message.photo.at(-1).file_id,kind:'photo'}:message.document&&['image/png','image/jpeg','image/webp'].includes(message.document.mime_type)?{file_id:message.document.file_id,kind:'document'}:null;
   if(!source)throw new ShopError('Надішліть саме фото або файл зображення з цим підписом.');await run(this.db,'INSERT INTO assets VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET file_id=excluded.file_id,kind=excluded.kind',[key,source.file_id,source.kind]);return this.send('Зображення збережено: '+esc(key)+'.');
  }
  throw new ShopError('Невідома команда. Відкрийте /admin.');
 }
 async export(){
  const rows=await all(this.db,'SELECT * FROM orders ORDER BY id DESC LIMIT 1000');const safe=v=>{let s=String(v??'');if(/^[=+\-@\t\r]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};
  const table=[['Номер','Дата UTC','Режим','Статус','Сума грн','Ім’я','Телефон','Місто','Доставка','Відділення','Оплата','ТТН','Товари']];for(const r of rows){const c=JSON.parse(r.customer),items=JSON.parse(r.items);table.push([r.id,r.created_at,r.mode,STATUS[r.status],r.total,c.name,c.phone,c.city,DELIVERY[c.delivery],c.branch,PAYMENTS[c.payment],r.tracking,items.map(i=>i.name+' '+i.label+' ×'+i.quantity).join('; ')]);}
  const form=new FormData();form.append('chat_id',String(this.uid));form.append('document',new Blob(['\ufeff'+table.map(row=>row.map(safe).join(',')).join('\r\n')],{type:'text/csv'}),'FORMULOVE_orders.csv');form.append('caption','Останні 1000 замовлень. Містить персональні дані: зберігайте захищено.');let response,data;try{response=await fetch('https://api.telegram.org/bot'+this.env.BOT_TOKEN+'/sendDocument',{method:'POST',body:form,signal:AbortSignal.timeout(15000)});data=await response.json();}catch{throw new TelegramError();}if(!response.ok||!data.ok)throw new TelegramError(data.error_code||response.status);
 }
 async handle(update){
  const q=update.callback_query,m=q?.message||update.message,sender=q?.from||m?.from;if(!sender||sender.is_bot||m?.chat?.type!=='private'||m.chat.id!==this.uid)return;
  if(q){try{await telegram(this.env,'answerCallbackQuery',{callback_query_id:q.id});}catch{}if(!await this.features.gate(String(q.data).split(':')[0]))return;return this.callback(q.data);}
  const raw=String(m.text||m.caption||'').trim(),space=raw.indexOf(' '),head=(space<0?raw:raw.slice(0,space)).split('@')[0],text=head+(space<0?'':raw.slice(space));
  if(await this.features.message(m,raw,head))return;
  if(head==='/start'||raw==='Головне меню')return this.home();if(head==='/all'||raw==='Показати все'||raw==='Усі моделі')return this.callback('all:0');if(raw==='Назад')return this.checkoutBack();if(head==='/id')return this.send('Ваш Telegram ID: <code>'+this.uid+'</code>');if(head==='/cancel'||raw==='Скасувати оформлення')return this.callback('checkout_cancel');if(head==='/catalog'||raw==='Каталог')return this.callback('catalog');if(head==='/cart'||raw==='Кошик')return this.callback('cart');if(head==='/orders')return this.orders(adminIds(this.env).includes(this.uid));if(raw==='Мої замовлення')return this.orders();if(head==='/help'||raw==='Про покупку'||raw==='Допомога')return this.info();if(head.startsWith('/'))return this.admin(text,m);return this.text(m);
 }
}

export async function drain(shop,limit=4){
 const db=shop.db,env=shop.env;const candidates=await all(db,"SELECT id FROM outbox WHERE (state='pending' AND next_try<=?) OR (state='sending' AND lock_until<?) ORDER BY id LIMIT ?",[epoch(),epoch(),limit]);
 for(const r of candidates){const event=await first(db,"UPDATE outbox SET state='sending',lock_until=? WHERE id=? AND ((state='pending' AND next_try<=?) OR (state='sending' AND lock_until<?)) RETURNING *",[epoch()+90,r.id,epoch(),epoch()]);if(!event)continue;
  try{const o=await shop.order(event.order_id);let text=receipt(o,['buyer_new','admin_new','admin_status'].includes(event.kind));
   if(event.kind==='buyer_new')text='<b>Замовлення отримали</b>\n\n'+text+'\n\n'+(o.mode==='demo'?'Це тест — без оплати.':'Напишемо вам, щоб погодити деталі.');
   if(event.kind==='buyer_status'&&o.status==='confirmed'&&o.customer.payment==='transfer'&&o.mode==='live')text+='\n\nРеквізити:\n'+esc(shop.store.bank_details)+'\nПризначення: замовлення FORMULOVE №'+o.id+'.';
   if(event.chat_id<0)text+='\n\nДля керування відкрийте приватний чат з ботом: /order '+o.id;
   const controls=[[btn('Відкрити замовлення','order:'+o.id)]];if(event.chat_id===o.user_id&&o.mode==='live'&&onlineReady(env)&&o.status==='confirmed')controls.unshift([btn('Оплатити карткою / гаманцем','pay:'+o.id)]);await send(env,event.chat_id,text,event.chat_id<0?kb():kb(...controls));await run(db,"UPDATE outbox SET state='done',lock_until=0 WHERE id=?",[event.id]);
  }catch(error){const delay=Math.max(error.retry||0,Math.min(3600,30*2**Math.min(event.attempts,6)));await run(db,"UPDATE outbox SET state='pending',attempts=attempts+1,next_try=?,lock_until=0 WHERE id=?",[epoch()+delay,event.id]);}
 }
}
