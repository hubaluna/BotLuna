import { ShopError,STATUS,NEXT,DELIVERY,PAYMENTS,HOME,esc,money,phone,randomToken,adminIds,targets,stmt,first,all,run,epoch,stamp,telegram,TelegramError,btn,kb,send,media,publicError } from './core.js';

export function receipt(o,details=false){
 const lines=[];if(o.id)lines.push('<b>FORMULOVE · №'+String(o.id).padStart(6,'0')+'</b>');if(o.mode==='demo')lines.push('ТЕСТОВЕ ЗАМОВЛЕННЯ · нічого не сплачуйте');lines.push('Статус: '+STATUS[o.status]);
 for(const i of o.items)lines.push('\n'+esc(i.name)+'\n'+esc(i.label)+' · '+i.quantity+' × '+money(i.unit_price));
 lines.push('\nТовари: '+money(o.goods_total),esc(o.package_name)+': '+money(o.packaging_total),'<b>Разом: '+money(o.total)+'</b>','Доставка та комісія післяплати — окремо.');
 if(details){const c=o.customer;lines.push('\nОдержувач: '+esc(c.name),'Телефон: '+esc(c.phone),'Місто: '+esc(c.city),DELIVERY[c.delivery]+': '+esc(c.branch),'Оплата: '+PAYMENTS[c.payment]);if(c.comment)lines.push('Коментар: '+esc(c.comment));}
 if(o.tracking)lines.push('\nТТН Нової пошти: <code>'+esc(o.tracking)+'</code>');return lines.join('\n');
}

export class Bot {
 constructor(shop,uid,updateId){this.shop=shop;this.db=shop.db;this.env=shop.env;this.uid=uid;this.updateId=updateId;}
 get store(){return this.shop.store;}
 send(text,markup){return send(this.env,this.uid,text,markup);}
 back(){return kb([btn('Скасувати оформлення','checkout_cancel')]);}
 support(){const rows=[];if(this.store.support_url)rows.push([{text:'Написати FORMULOVE',url:this.store.support_url}]);rows.push([btn('Про покупку','info'),btn('Каталог','catalog')]);return kb(...rows);}
 async home(){
  await this.shop.reset(this.uid);const demo=this.store.mode==='demo'?'\n\n<b>Демонстраційний магазин.</b> Ціни й характеристики попередні. Замовлення тестові, оплата не приймається.':'';
  await this.send('<b>FORMULOVE</b>\nЛюбов до швидкості. Одяг на щодень.\n\nМаленька вишивка, стримані кольори та власні символи. Оберіть річ для себе або подарунок людині зі спільним захопленням.'+demo,HOME);
  await media(this.env,this.uid,this.shop.assets.welcome,this.store.images_are_concepts?'Концепції вишивки, не фото фізичного зразка.':'FORMULOVE');
  await this.send('З чого почнемо?',kb([btn('Обрати мерч','catalog')],[btn('Кошик','cart'),btn('Допомога з покупкою','info')]));
 }
 async catalog(){const rows=this.shop.categories.filter(c=>Object.values(this.shop.products).some(p=>p.active&&p.category===c.id)).map(c=>[btn(c.name,'cat:'+c.id)]);await this.send('<b>Каталог FORMULOVE</b>\nОберіть категорію. Ціни в гривнях; комплекти — за дві речі.',kb(...rows,[btn('Кошик','cart')]));}
 async category(id){const c=this.shop.categories.find(c=>c.id===id);if(!c)throw new ShopError('Категорію не знайдено.');await this.send('<b>'+esc(c.name)+'</b>',kb(...Object.values(this.shop.products).filter(p=>p.active&&p.category===id).map(p=>[btn(p.name+' · '+money(p.price_uah),'product:'+p.id)]),[btn('Усі категорії','catalog')]));}
 async product(id){
  const p=this.shop.get(id);await media(this.env,this.uid,this.shop.assets['product:'+id]||(p.photo?{kind:'photo',file_id:p.photo}:null),p.name);
  const text='<b>'+esc(p.name)+'</b>\n<b>'+money(p.price_uah)+'</b>'+(p.pair?' за комплект із 2 речей':'')+'\n\n'+esc(p.description)+'\n\n'+esc(p.materials)+'\n'+esc(p.embroidery)+'\n\n'+esc(this.store.dispatch_text)+(this.store.mode==='demo'?'\n\nПопередні ціна й характеристики; зразок ще не затверджено.':'')+'\n\nОберіть колір:';
  await this.send(text,kb(...p.colors.map(c=>[btn(c.name,'color:'+id+':'+c.id)]),[btn('Розміри та посадка','measure:'+id)],[btn('Назад','cat:'+p.category),btn('Кошик','cart')]));
 }
 async sizes(id,color,size1=''){
  const p=this.shop.get(id);if(!p.colors.some(c=>c.id===color)||(size1&&!p.sizes.includes(size1)))throw new ShopError('Варіант не знайдено.');
  const stock=Object.fromEntries((await all(this.db,'SELECT variant,quantity FROM stock WHERE variant LIKE ?',[id+':%'])).map(r=>[r.variant,r.quantity]));const buttons=[];
  for(const size of p.sizes){let data,key;
   if(size1){key=this.shop.variant(id,color,size1,size);data='add2:'+id+':'+color+':'+size1+':'+size;}
   else if(p.pair){data='first:'+id+':'+color+':'+size;}
   else{key=this.shop.variant(id,color,size);data='add:'+id+':'+color+':'+size;}
   const available=key?!!stock[key]:Object.entries(stock).some(([k,q])=>k.startsWith([id,color,size].join(':')+':')&&q!==0);
   buttons.push(btn(size+(available?'':' — немає'),available?data:'unavailable'));
  }
  const rows=[];for(let i=0;i<buttons.length;i+=3)rows.push(buttons.slice(i,i+3));rows.push([btn('Заміри','measure:'+id),btn('Назад','product:'+id)]);
  await this.send('<b>'+esc(p.name)+'</b>\nОберіть розмір '+(p.pair?(size1?'другої':'першої')+' речі':'')+':',kb(...rows));
 }
 async measures(id){const p=this.shop.get(id);await this.send('<b>Розмір і посадка</b>\n'+esc(p.fit)+'\n\n'+(p.measurements.length?'Заміри виробу на рівній поверхні, см:\n'+p.measurements.map(esc).join('\n'):'Точні заміри ще не затверджені. Дочекайтеся перевірки зразка або зверніться до менеджера.')+'\n\nПорівняйте зі своєю річчю. Для парного комплекту розміри обираються окремо.',kb([btn('До товару','product:'+id)],[btn('Про покупку','info')]));}
 async cart(){
  const rows=await all(this.db,'SELECT c.*,s.quantity AS available FROM carts c LEFT JOIN stock s ON s.variant=c.variant WHERE user_id=? ORDER BY c.id',[this.uid]);if(!rows.length){await this.send('Кошик поки порожній. Знайдемо вашу річ?',kb([btn('Відкрити каталог','catalog')]));return;}
  const lines=['<b>Ваш кошик</b>'],buttons=[];let total=0;
  for(const r of rows){try{const {p,label}=this.shop.parseVariant(r.variant);total+=r.quantity*p.price_uah;lines.push('\n'+esc(p.name)+'\n'+esc(label)+' · '+r.quantity+' × '+money(p.price_uah)+'\n'+(r.available===-1?'під замовлення':r.available<r.quantity?'немає потрібної кількості':'є в наявності'));}catch{lines.push('\nНедоступний товар — приберіть його.');}buttons.push([btn('−','qty:'+r.id+':-1'),btn(r.quantity+' шт.','noop'),btn('+','qty:'+r.id+':1'),btn('Прибрати','remove:'+r.id)]);}
  lines.push('\n<b>Товари: '+money(total)+'</b>\nПакування оберете далі. Доставка й можлива комісія післяплати оплачуються окремо.');buttons.push([btn('Оформити замовлення','checkout')],[btn('Продовжити вибір','catalog'),btn('Очистити','clearask')]);await this.send(lines.join('\n'),kb(...buttons));
 }
 async checkout(){await this.shop.quote(this.uid);await this.shop.saveSession(this.uid,{step:'name',customer:{package:'standard'}},this.updateId);await this.send('<b>Оформлення · 1/8</b>\nВкажіть ім’я та прізвище одержувача.',this.back());}
 async consentText(){await this.send('<b>Оформлення · 8/8</b>\n'+esc(this.store.privacy_text)+'\n\nЗгода стосується обробки даних для цього замовлення, не рекламної розсилки.',kb([btn('Умови покупки','info:terms'),btn('Повернення','info:returns')],[btn('Погоджуюсь · перевірити замовлення','consent')],[btn('Не погоджуюсь · скасувати','checkout_cancel')]));}
 async review(){
  const s=await this.shop.session(this.uid);const q=await this.shop.quote(this.uid,s.customer.package);s.step='review';s.token=randomToken();s.fingerprint=q.fingerprint;await this.shop.saveSession(this.uid,s,this.updateId);
  const o={id:0,mode:this.store.mode,status:'new',items:q.items,customer:s.customer,package_name:q.package_name,goods_total:q.goods,packaging_total:q.packaging,total:q.total};
  await this.send('<b>Перевірте перед підтвердженням</b>\n\n'+receipt(o,true)+'\n\nПідтвердження збереже замовлення. Менеджер погодить наявність і строк відправлення. Кошти зараз не списуються.',kb([btn(this.store.mode==='demo'?'Підтвердити тестове замовлення':'Підтвердити замовлення','place:'+s.token)],[btn('Ввести дані заново','checkout'),btn('Скасувати','checkout_cancel')]));
 }
 async text(message){
  const s=await this.shop.session(this.uid);if(s.last_update===this.updateId)return;const c=s.customer||{};const text=String(message.text||'').trim();
  if(!s.step){await this.send('Оберіть дію в меню. Умови покупки й контакт — у розділі «Про покупку».',HOME);return;}
  if(s.step==='name'){
   if(text.split(/\s+/).length<2||text.length<3||text.length>100)throw new ShopError('Вкажіть ім’я та прізвище, до 100 символів.');c.name=text;s.step='phone';
   await this.shop.saveSession(this.uid,{...s,customer:c},this.updateId);await this.send('<b>Оформлення · 2/8</b>\nНапишіть телефон одержувача або поділіться своїм контактом.',{keyboard:[[{text:'Поділитися моїм номером',request_contact:true}],[{text:'Скасувати оформлення'}]],resize_keyboard:true,one_time_keyboard:true});return;
  }
  if(s.step==='phone'){
   let raw=text;if(message.contact){if(message.contact.user_id!==this.uid)throw new ShopError('Поділіться власним контактом або введіть телефон одержувача вручну.');raw=message.contact.phone_number;}c.phone=phone(raw);s.step='city';await this.shop.saveSession(this.uid,{...s,customer:c},this.updateId);await this.send('<b>Оформлення · 3/8</b>\nНапишіть місто/населений пункт. За потреби додайте область.',HOME);return;
  }
  if(s.step==='city'){
   if(text.length<2||text.length>100)throw new ShopError('Назва населеного пункту — 2–100 символів.');c.city=text;s.step='delivery';await this.shop.saveSession(this.uid,{...s,customer:c},this.updateId);await this.send('<b>Оформлення · 4/8</b>\nОберіть доставку. Її оплачує покупець окремо.',kb(...Object.entries(DELIVERY).map(([k,v])=>[btn(v,'delivery:'+k)]),[btn('Скасувати','checkout_cancel')]));return;
  }
  if(s.step==='branch'){
   if(text.length<1||text.length>160)throw new ShopError('Вкажіть номер і/або адресу відділення, до 160 символів.');c.branch=text;s.step='package';await this.shop.saveSession(this.uid,{...s,customer:c},this.updateId);await this.send('<b>Оформлення · 5/8</b>\nОберіть пакування:',kb(...this.store.packages.map(p=>[btn(p.name+' · '+money(p.price_uah),'package:'+p.id)]),[btn('Про пакування','info:packaging')]));return;
  }
  if(s.step==='comment'){
   if(text.length>500)throw new ShopError('Коментар — до 500 символів.');c.comment=text==='Пропустити'?'':text;s.step='consent';await this.shop.saveSession(this.uid,{...s,customer:c},this.updateId);await this.consentText();return;
  }
  await this.send('На цьому кроці скористайтеся кнопками або почніть оформлення заново.',this.back());
 }
 async orders(admin=false){
  const rows=admin?await all(this.db,'SELECT id,status,total,mode FROM orders ORDER BY id DESC LIMIT 15'):await all(this.db,'SELECT id,status,total,mode FROM orders WHERE user_id=? ORDER BY id DESC LIMIT 10',[this.uid]);if(!rows.length){await this.send('Замовлень поки немає.',this.support());return;}
  await this.send('<b>Останні замовлення</b>',kb(...rows.map(o=>[btn('№'+String(o.id).padStart(6,'0')+' · '+STATUS[o.status]+' · '+money(o.total)+(o.mode==='demo'?' · тест':''),'order:'+o.id)]),[btn('Головне меню','home')]));
 }
 async viewOrder(id){
  const o=await this.shop.order(id),admin=adminIds(this.env).includes(this.uid);if(!o||(!admin&&o.user_id!==this.uid))throw new ShopError('Замовлення не знайдено.');const rows=[];
  if(admin){for(const status of NEXT[o.status])if(status!=='shipped')rows.push([btn(STATUS[status],'statusask:'+id+':'+status)]);}
  else if(o.status==='new')rows.push([btn('Скасувати замовлення','cancelask:'+id)]);
  rows.push([btn('Мої замовлення','orders'),btn('Про покупку','info')]);await this.send(receipt(o,true),kb(...rows));
  if(admin&&['paid','processing'].includes(o.status))await this.send('Для відправлення: <code>/ship '+id+' 20450000000000</code>\nЗамініть приклад справжньою ТТН.');
 }
 async info(topic=''){
  if(!topic){await this.send('<b>Усе про покупку</b>',kb(...[['about','Про FORMULOVE'],['delivery','Доставка і строки'],['payment','Оплата'],['returns','Обміни й повернення'],['care','Догляд'],['packaging','Пакування'],['privacy','Ваші дані'],['terms','Умови покупки'],['faq','Поширені запитання']].map(([k,v])=>[btn(v,'info:'+k)]),...this.support().inline_keyboard));return;}
  const texts={about:'FORMULOVE — незалежний український бренд, натхненний швидкістю й культурою автоспорту. Власні символи, маленька вишивка, повсякденні речі. Не офіційний мерч гоночних серій або команд.',delivery:this.store.delivery_text+'\n\n'+this.store.dispatch_text,payment:this.store.payment_text,returns:this.store.returns_text,care:this.store.care_text,privacy:this.store.privacy_text,packaging:this.store.packages.map(p=>p.name+' · '+money(p.price_uah)+'\n'+p.description).join('\n\n'),terms:(this.store.seller_name?'Продавець: '+this.store.seller_name+'\n'+this.store.seller_details:'Магазин готується до відкриття. Реквізити продавця ще не внесено, реальні покупки недоступні.')+'\n\n'+this.store.payment_text+'\n\n'+this.store.delivery_text+'\n\n'+this.store.returns_text,faq:'Як обрати розмір? Порівняйте заміри конкретного виробу зі своєю річчю. Якщо замірів ще немає, дочекайтеся їх або зверніться до менеджера.\n\nЧи можна різні розміри в парі? Так, кожен обирається окремо.\n\nПерсоналізація? За окремим погодженням до оплати.\n\nЯк відстежити замовлення? «Мої замовлення». Після відправлення з’явиться ТТН.\n\nЦе офіційний мерч? Ні, це незалежний бренд.\n\nЯк змінити замовлення? До підтвердження менеджером можна скасувати й оформити заново; після — звернутися до менеджера.'};
  if(!texts[topic])throw new ShopError('Розділ не знайдено.');
  if(topic==='packaging')await media(this.env,this.uid,this.shop.assets.packaging,this.store.images_are_concepts?'Концепція пакування, не фото готового замовлення.':'Пакування FORMULOVE');
  const text=texts[topic];for(let at=0;at<text.length;at+=3500){await telegram(this.env,'sendMessage',{chat_id:this.uid,text:text.slice(at,at+3500),reply_markup:at+3500>=text.length?this.support():kb(),link_preview_options:{is_disabled:true}});}
 }
 async callback(data){
  const [action,...p]=String(data).split(':');
  if(action==='home')return this.home();
  if(action==='catalog'){await this.shop.reset(this.uid);return this.catalog();}
  if(action==='cat')return this.category(p[0]);if(action==='product')return this.product(p[0]);if(action==='measure')return this.measures(p[0]);if(action==='color')return this.sizes(p[0],p[1]);
  if(action==='first'){if(!this.shop.get(p[0]).pair)throw new ShopError('Це не комплект.');return this.sizes(p[0],p[1],p[2]);}
  if(['add','add2'].includes(action)){const key=this.shop.variant(p[0],p[1],p[2],action==='add2'?p[3]:'');await this.shop.changeCart(this.uid,key,1,'u:'+this.updateId);await this.shop.reset(this.uid);return this.send('Додано до кошика ✓',kb([btn('До кошика','cart'),btn('Обрати ще','catalog')]));}
  if(action==='cart'){await this.shop.reset(this.uid);return this.cart();}
  if(action==='qty'||action==='remove'){const r=await first(this.db,'SELECT variant FROM carts WHERE id=? AND user_id=?',[Number(p[0]),this.uid]);if(!r)throw new ShopError('Позицію вже змінено. Оновіть кошик.');const delta=action==='remove'?'remove':Number(p[1]);if(!['remove',1,-1].includes(delta))throw new ShopError('Некоректна кількість.');await this.shop.changeCart(this.uid,r.variant,delta,'u:'+this.updateId);await this.shop.reset(this.uid);return this.cart();}
  if(action==='clearask')return this.send('Очистити кошик?',kb([btn('Так, очистити','clear'),btn('Залишити','cart')]));
  if(action==='clear'){await run(this.db,'DELETE FROM carts WHERE user_id=?',[this.uid]);await this.shop.reset(this.uid);return this.cart();}
  if(action==='checkout')return this.checkout();
  if(action==='checkout_cancel'){await this.shop.reset(this.uid);return this.send('Оформлення скасовано. Товари залишилися в кошику.',HOME);}
  if(['delivery','package','payment','skipcomment','consent'].includes(action)){
   const s=await this.shop.session(this.uid);const expected={delivery:'delivery',package:'package',payment:'payment',skipcomment:'comment',consent:'consent'}[action];if(s.step!==expected)throw new ShopError('Цей крок уже неактуальний. Продовжіть поточне оформлення або почніть заново.');const c=s.customer;
   if(action==='delivery'){if(!DELIVERY[p[0]])throw new ShopError('Оберіть доставку зі списку.');c.delivery=p[0];s.step='branch';await this.shop.saveSession(this.uid,s,this.updateId);return this.send('Вкажіть номер і/або адресу '+(p[0]==='locker'?'поштомата.':'відділення Нової пошти.'),this.back());}
   if(action==='package'){if(!this.store.packages.some(x=>x.id===p[0]))throw new ShopError('Невідоме пакування.');c.package=p[0];s.step='payment';await this.shop.saveSession(this.uid,s,this.updateId);return this.send('<b>Оформлення · 6/8</b>\nОберіть оплату. Зараз кошти не списуються.',kb(...this.store.payment_methods.map(k=>[btn(PAYMENTS[k],'payment:'+k)]),[btn('Умови оплати','info:payment')]));}
   if(action==='payment'){if(!this.store.payment_methods.includes(p[0]))throw new ShopError('Ця оплата недоступна.');c.payment=p[0];s.step='comment';await this.shop.saveSession(this.uid,s,this.updateId);return this.send('<b>Оформлення · 7/8</b>\nПобажання до замовлення? До 500 символів або пропустіть.',kb([btn('Без коментаря','skipcomment')]));}
   if(action==='skipcomment'){c.comment='';s.step='consent';await this.shop.saveSession(this.uid,s,this.updateId);return this.consentText();}
   c.consent=true;await this.shop.saveSession(this.uid,s,this.updateId);return this.review();
  }
  if(action==='place'){
   const old=await first(this.db,'SELECT id FROM orders WHERE token=? AND user_id=?',[p[0],this.uid]);if(old)return this.viewOrder(old.id);
   const s=await this.shop.session(this.uid);if(s.step!=='review'||s.token!==p[0])throw new ShopError('Підтвердження застаріло. Оформіть замовлення заново.');await this.shop.place(this.uid,s.token,s.customer,s.fingerprint);return;
  }
  if(action==='orders')return this.orders();if(action==='order')return this.viewOrder(Number(p[0]));
  if(action==='cancelask'){const o=await this.shop.order(Number(p[0]));if(!o||o.user_id!==this.uid||o.status!=='new')throw new ShopError('Скасування недоступне. Напишіть менеджеру.');return this.send('Скасувати замовлення №'+o.id+'?',kb([btn('Так, скасувати','canceldo:'+o.id),btn('Залишити','order:'+o.id)]));}
  if(action==='canceldo'){await this.shop.status(Number(p[0]),'cancelled',this.uid,{buyer:true});return this.viewOrder(Number(p[0]));}
  if(['statusask','status','adminorders'].includes(action)){
   if(!adminIds(this.env).includes(this.uid))throw new ShopError('Немає доступу.');if(action==='adminorders')return this.orders(true);
   const id=Number(p[0]),status=p[1];if(!STATUS[status])throw new ShopError('Невідомий статус.');if(action==='statusask')return this.send('Змінити статус №'+id+' на «'+STATUS[status]+'»?'+(status==='cancelled'?' Це не повертає гроші автоматично.':''),kb([btn('Підтвердити','status:'+id+':'+status),btn('Назад','order:'+id)]));await this.shop.status(id,status,this.uid);return this.viewOrder(id);
  }
  if(action==='info')return this.info(p[0]);if(action==='unavailable')throw new ShopError('Цього варіанта зараз немає. Спробуйте інший розмір або колір.');if(action!=='noop')throw new ShopError('Кнопка застаріла. Відкрийте /start.');
 }
 async admin(text,message){
  if(!adminIds(this.env).includes(this.uid))throw new ShopError('Команда доступна лише власнику.');
  const [command,...rest]=text.split(' ');const arg=rest.join(' ').trim();
  if(command==='/admin')return this.send('<b>Керування FORMULOVE</b>\n/orders — замовлення\n/order 1 — картка\n/price heart 1190 — ціна\n/variants heart — ключі варіантів\n/stock heart:black:M: 5 — залишок\n/show heart on або off — показ товару\n/ship 1 ТТН — відправлення\n/stats — суми замовлень\n/export — CSV\n\nНадішліть фото з підписом /photo heart для картки товару. Для головної ілюстрації: /asset welcome. Для пакування: /asset packaging. Можна надіслати зображення файлом без стискання. Тексти й решта налаштувань — у вебпанелі /setup за адресою Worker.',kb([btn('Замовлення магазину','adminorders')]));
  if(command==='/order')return this.viewOrder(Number(arg));
  if(command==='/price'){const [pid,price]=arg.split(/\s+/),value=Number(price);const p=this.shop.get(pid);if(!Number.isInteger(value)||value<1||value>100000)throw new ShopError('Ціна — ціле число 1–100000 грн.');await run(this.db,'UPDATE products SET price=? WHERE id=?',[value,pid]);return this.send(esc(p.name)+': '+money(value));}
  if(command==='/show'){const [pid,flag]=arg.split(/\s+/);if(!this.shop.products[pid]||!['on','off'].includes(flag))throw new ShopError('Приклад: /show heart off');await run(this.db,'UPDATE products SET active=? WHERE id=?',[flag==='on'?1:0,pid]);return this.send('Видимість товару оновлено. Для live перевірте фото й заміри.');}
  if(command==='/variants'){const p=this.shop.get(arg);const rows=await all(this.db,'SELECT variant,quantity FROM stock WHERE variant LIKE ? ORDER BY variant',[p.id+':%']);for(let i=0;i<rows.length;i+=25)await this.send('<b>Варіанти</b>\n'+rows.slice(i,i+25).map(r=>esc(r.variant)+' → '+(r.quantity===-1?'під замовлення':r.quantity)).join('\n'));return;}
  if(command==='/stock'){const at=arg.lastIndexOf(' '),variant=arg.slice(0,at),quantity=Number(arg.slice(at+1));this.shop.parseVariant(variant);if(at<0||!Number.isInteger(quantity)||quantity< -1||quantity>100000)throw new ShopError('Залишок: -1 або ціле число від 0 до 100000.');await run(this.db,'UPDATE stock SET quantity=? WHERE variant=?',[quantity,variant]);return this.send('Оновлено доступний залишок. Зарезервовані замовлення вже відняті.');}
  if(command==='/ship'){const [id,tracking]=arg.split(/\s+/);await this.shop.status(Number(id),'shipped',this.uid,{tracking});return this.viewOrder(Number(id));}
  if(command==='/stats'){const rows=await all(this.db,"SELECT mode,COUNT(*) n,COALESCE(SUM(total),0) total FROM orders WHERE status!='cancelled' GROUP BY mode");return this.send('<b>Замовлення за весь час</b>\nСуми — замовлена вартість, не прибуток і не підтверджені надходження.\n\n'+rows.map(r=>r.mode+': '+r.n+' · '+money(r.total)).join('\n'));}
  if(command==='/export')return this.export();
  if(command==='/photo'||command==='/asset'){
   let key;if(command==='/photo'){if(!this.shop.products[arg])throw new ShopError('Вкажіть ID товару, наприклад /photo heart');key='product:'+arg;}else{if(!['welcome','packaging'].includes(arg))throw new ShopError('Приклад: /asset welcome або /asset packaging');key=arg;}
   const source=message.photo?.length?{file_id:message.photo.at(-1).file_id,kind:'photo'}:message.document&&['image/png','image/jpeg','image/webp'].includes(message.document.mime_type)?{file_id:message.document.file_id,kind:'document'}:null;
   if(!source)throw new ShopError('Надішліть саме фото або файл зображення з цим підписом.');await run(this.db,'INSERT INTO assets VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET file_id=excluded.file_id,kind=excluded.kind',[key,source.file_id,source.kind]);return this.send('Зображення збережено для '+esc(key)+'. Файл лишається в Telegram; токен та зображення не виводяться публічно.');
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
  if(q){try{await telegram(this.env,'answerCallbackQuery',{callback_query_id:q.id});}catch{}return this.callback(q.data);}
  const raw=String(m.text||m.caption||'').trim(),space=raw.indexOf(' '),head=(space<0?raw:raw.slice(0,space)).split('@')[0],text=head+(space<0?'':raw.slice(space));
  if(head==='/start'||raw==='Головне меню')return this.home();if(head==='/id')return this.send('Ваш Telegram ID: <code>'+this.uid+'</code>');if(head==='/cancel'||raw==='Скасувати оформлення')return this.callback('checkout_cancel');if(head==='/catalog'||raw==='Каталог')return this.callback('catalog');if(head==='/cart'||raw==='Кошик')return this.callback('cart');if(head==='/orders')return this.orders(adminIds(this.env).includes(this.uid));if(raw==='Мої замовлення')return this.orders();if(head==='/help'||raw==='Про покупку')return this.info();if(head.startsWith('/'))return this.admin(text,m);return this.text(m);
 }
}

export async function drain(shop,limit=4){
 const db=shop.db,env=shop.env;const candidates=await all(db,"SELECT id FROM outbox WHERE (state='pending' AND next_try<=?) OR (state='sending' AND lock_until<?) ORDER BY id LIMIT ?",[epoch(),epoch(),limit]);
 for(const r of candidates){const event=await first(db,"UPDATE outbox SET state='sending',lock_until=? WHERE id=? AND ((state='pending' AND next_try<=?) OR (state='sending' AND lock_until<?)) RETURNING *",[epoch()+90,r.id,epoch(),epoch()]);if(!event)continue;
  try{const o=await shop.order(event.order_id);let text=receipt(o,['buyer_new','admin_new','admin_status'].includes(event.kind));
   if(event.kind==='buyer_new')text='<b>Замовлення збережено ✓</b>\n\n'+text+'\n\n'+(o.mode==='demo'?'Це тест. Нічого не сплачуйте.':'Очікуйте підтвердження менеджера та погодження строку відправлення.');
   if(event.kind==='buyer_status'&&o.status==='confirmed'&&o.customer.payment==='transfer'&&o.mode==='live')text+='\n\nРеквізити:\n'+esc(shop.store.bank_details)+'\nПризначення: замовлення FORMULOVE №'+o.id+'.';
   if(event.chat_id<0)text+='\n\nДля керування відкрийте приватний чат з ботом: /order '+o.id;
   await send(env,event.chat_id,text,event.chat_id<0?kb():kb([btn('Відкрити замовлення','order:'+o.id)]));await run(db,"UPDATE outbox SET state='done',lock_until=0 WHERE id=?",[event.id]);
  }catch(error){const delay=Math.max(error.retry||0,Math.min(3600,30*2**Math.min(event.attempts,6)));await run(db,"UPDATE outbox SET state='pending',attempts=attempts+1,next_try=?,lock_until=0 WHERE id=?",[epoch()+delay,event.id]);}
 }
}
