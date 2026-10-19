import {ShopError,HOME,STATUS,esc,money,phone,first,all,run,stmt,stamp,randomToken,adminIds,kb,btn,media,onlineReady} from './core.js';
import {profile,verifyContact,marketing,analytics,cash,balances,recordReceipt,draftCampaign,queueCampaign} from './commerce.js';
import {invoice,syncInvoice} from './payments.js';
import {notifyBuyer} from './notifications.js';
export const FEATURE_ACTIONS=new Set(['profile','account_phone','news','recipient','track','cashask','cashconfirm','pay','paycheck','campaignstart','campaignsend','campaigncancel']);
export class BotFeatures{
 constructor(bot){this.bot=bot;this.shop=bot.shop;this.db=bot.db;this.uid=bot.uid;this.env=bot.env;}
 send(text,markup){return this.bot.send(text,markup);}
 owner(){if(!adminIds(this.env).includes(this.uid))throw new ShopError('Немає доступу.');}
 async phonePrompt(){await this.shop.saveSession(this.uid,{step:'account_phone'},this.bot.updateId);return this.send('<b>Вітаємо у FORMULOVE</b>\n\nПідтвердіть свій номер кнопкою нижче. Збережемо його в профілі та використаємо для замовлень. Новини — лише за вашою згодою.',{keyboard:[[{text:'Поділитися номером',request_contact:true}],[{text:'Про використання даних'}]],resize_keyboard:true,one_time_keyboard:true});}
 async start(){if(adminIds(this.env).includes(this.uid))return this.bot.adminUI.dashboard();const p=await profile(this.shop,this.uid);if(!p?.verified_at&&!adminIds(this.env).includes(this.uid))return this.phonePrompt();if(p)await run(this.db,'UPDATE customers SET blocked=0,last_seen=? WHERE user_id=?',[stamp(),this.uid]);return this.bot.home();}
 async gate(action){if(adminIds(this.env).includes(this.uid)||['info','orders','order','orderdetails','cancelask','canceldo','news','profile','account_phone'].includes(action))return true;const p=await profile(this.shop,this.uid);if(p?.verified_at)return true;await this.phonePrompt();return false;}
 async newsPrompt(){return this.send('Надсилати нові колекції та пропозиції FORMULOVE?',kb([btn('Так, хочу новини','news:on')],[btn('Ні, дякую','news:off')]));}
 async profile(){const p=await profile(this.shop,this.uid);if(!p?.verified_at)return this.phonePrompt();return this.send('<b>Мій профіль</b>\n'+esc(p.phone)+'\nНовини: '+(p.marketing?'увімкнено':'вимкнено'),kb([btn('Змінити номер','account_phone')],[btn(p.marketing?'Відписатися від новин':'Підписатися на новини','news:'+(p.marketing?'off':'on'))],[btn('Каталог','catalog'),btn('Мої замовлення','orders')]));}
 async checkout(){if(this.shop.store.orders_paused)return this.send('Приймання нових замовлень тимчасово призупинено. Напишіть нам.',this.bot.support());const p=await profile(this.shop,this.uid);if(!p?.verified_at)return this.phonePrompt();await this.shop.quote(this.uid);await this.shop.saveSession(this.uid,{step:'recipient',customer:{package:'standard'}},this.bot.updateId);return this.recipientPrompt();}
 recipientPrompt(){return this.send('Для кого замовлення?',kb([btn('Для себе','recipient:self')],[btn('Для іншої людини','recipient:other')],[btn('Скасувати','checkout_cancel')]));}
 async recipient(mode){if(!['self','other'].includes(mode))throw new ShopError('Оберіть одержувача.');const s=await this.shop.session(this.uid);if(s.step!=='recipient')throw new ShopError('Відкрийте оформлення ще раз.');const p=await profile(this.shop,this.uid);if(!p?.verified_at)return this.phonePrompt();s.customer={...s.customer,recipient_mode:mode};delete s.customer.name;delete s.customer.phone;
  if(mode==='self'){s.customer.phone=p.phone;if(p.full_name.trim().split(/\s+/).length>=2){s.customer.name=p.full_name;return this.bot.move(s,'city');}}
  return this.bot.move(s,'name');
 }
 async fromName(s){if(s.customer.recipient_mode!=='self')return this.bot.move(s,'phone');const p=await profile(this.shop,this.uid);s.customer.phone=p.phone;await run(this.db,'UPDATE customers SET full_name=? WHERE user_id=?',[s.customer.name,this.uid]);return this.bot.move(s,'city');}
 async measures(id){const p=this.shop.get(id),asset=this.shop.assets['size:'+id]||this.shop.assets.sizeguide||(id!=='cap'&&this.env.PUBLIC_BASE_URL?{kind:'photo',file_id:new URL('/guides/size-guide-v1.jpg',this.env.PUBLIC_BASE_URL).href}:null);
  const text=p.measurements.length?'<b>'+esc(p.name)+'</b>\nЗаміри виробу, см:\n'+p.measurements.map(esc).join('\n'):'<b>Розмірна сітка</b>\n'+(id==='cap'?'Кепка — ONE SIZE. Обхват погодимо до оплати.':'На схемі показано, як знімати заміри. Точні заміри цієї моделі погодимо до оплати.');
  const markup=kb([this.bot.contact()],[btn('До товару','product:'+id)]);if(asset&&text.length<1024&&await media(this.env,this.uid,asset,text,markup))return;return this.send(text,markup);
 }
 async tracking(id){this.owner();const o=await this.shop.order(id);if(!o||!['confirmed','paid','processing','shipped'].includes(o.status))throw new ShopError('Спершу підтвердіть замовлення.');await this.shop.saveSession(this.uid,{step:'admin_tracking',order_id:id},this.bot.updateId);return this.send('Замовлення №'+id+'\nНадішліть 14 цифр ТТН Нової пошти.',kb([btn('Скасувати','checkout_cancel')]));}
 async saveTracking(s,text){this.owner();if(!/^\d{14}$/.test(text))throw new ShopError('ТТН має містити 14 цифр без пробілів.');const o=await this.shop.order(s.order_id);if(!o)throw new ShopError('Замовлення не знайдено.');
  if(o.status==='shipped'){await this.db.batch([stmt(this.db,"UPDATE orders SET tracking=? WHERE id=? AND status='shipped'",[text,o.id]),stmt(this.db,"INSERT INTO outbox(chat_id,order_id,kind) VALUES(?,?,'buyer_status')",[o.user_id,o.id])]);}
  else await this.shop.status(o.id,'shipped',this.uid,{tracking:text});await this.shop.reset(this.uid);return this.bot.viewOrder(o.id);
 }
 async stats(){this.owner();const r=await analytics(this.shop);return this.send('<b>Продажі · останні 30 днів</b>\nЗамовлень live: '+r.summary.orders+'\nСума без скасованих: '+money(r.summary.ordered_uah)+'\nСередній чек: '+money(r.summary.average_order_uah)+'\nЗаписані оплати: '+cash(r.summary.received_kopecks)+'\nПовернення: '+cash(r.summary.refunded_kopecks)+'\nВитрати: '+cash(r.summary.expenses_kopecks)+'\nПідписників новин: '+(r.audience.subscribers||0)+'\n\nДеталі й CSV — у панелі /setup. Сума замовлень не є прибутком.',kb([btn('Замовлення','adminorders'),btn('Меню власника','adminhelp')]));}
 async callback(action,p){
  if(action==='profile')return this.profile();if(action==='account_phone')return this.phonePrompt();
  if(action==='news'){await marketing(this.shop,this.uid,p[0]==='on');return this.send(p[0]==='on'?'Підписку увімкнено. Відписатися можна в профілі або командою /unsubscribe.':'Новини вимкнено. Повідомлення про ваші замовлення залишаються.',HOME);}
  if(action==='recipient')return this.recipient(p[0]);if(action==='track')return this.tracking(Number(p[0]));
  if(action==='cashask'){this.owner();const o=await this.shop.order(Number(p[0]));if(!o)throw new ShopError('Замовлення не знайдено.');const b=await balances(this.shop,o.id);return this.send('Записати отриману оплату '+cash(o.total*100-b.received)+' за №'+o.id+'?\nНатискайте тільки після перевірки надходження грошей.',kb([btn('Так, гроші отримано','cashconfirm:'+o.id)],[btn('Назад','order:'+o.id)]));}
  if(action==='cashconfirm'){this.owner();await recordReceipt(this.shop,Number(p[0]),this.uid,'manual:'+Number(p[0]));return this.bot.viewOrder(Number(p[0]));}
  if(action==='pay'){const row=await invoice(this.shop,Number(p[0]),this.uid);return this.send('Оплата FORMULOVE\nНа захищеній сторінці monobank оберіть картку, Apple Pay або Google Pay. Доступність гаманця залежить від пристрою та браузера.',kb([{text:'Перейти до оплати',url:row.page_url}],[btn('Перевірити оплату','paycheck:'+p[0])],[btn('До замовлення','order:'+p[0])]));}
  if(action==='paycheck'){
   const o=await this.shop.order(Number(p[0]));if(!o||(o.user_id!==this.uid&&!adminIds(this.env).includes(this.uid)))throw new ShopError('Замовлення не знайдено.');const state=await syncInvoice(this.shop,o.id);
   if(state==='success'&&o.user_id===this.uid){const result=await notifyBuyer(this.shop,await this.shop.order(o.id),'paid');if(result==='done')return this.send('Оплату вже підтверджено.',kb([btn('Ваше замовлення','order:'+o.id)]));return;}
   return this.send(state==='success'?'Оплату отримали.':state==='reversed'?'Платіж повернено.':'Оплата '+({created:'ще не надійшла.',processing:'обробляється.',hold:'очікує підтвердження банку.',failure:'не пройшла.',expired:'не надійшла: строк рахунку минув.'}[state]||'ще не підтверджена.'),kb([btn('Ваше замовлення','order:'+o.id)]));
  }
  if(action==='campaignstart'){this.owner();await this.shop.saveSession(this.uid,{step:'campaign_draft'},this.bot.updateId);return this.send('Надішліть текст новини, до 2500 символів. Спершу покажу попередній перегляд.',kb([btn('Скасувати','checkout_cancel')]));}
  if(action==='campaignsend'){this.owner();await queueCampaign(this.shop,Number(p[0]),this.uid);return this.send('Розсилку поставлено в чергу. Отримають лише підписники, які не відписалися й не заблокували бота.');}
  if(action==='campaigncancel'){this.owner();await run(this.db,"UPDATE campaigns SET state='cancelled' WHERE id=? AND state='draft'",[Number(p[0])]);return this.send('Чернетку скасовано.');}
 }
 async message(m,raw,head){
  if(head==='/start'||raw==='Головне меню'){await this.start();return true;}
  if(head==='/profile'||raw==='Мій профіль'){await this.profile();return true;}
  if(head==='/unsubscribe'||head==='/stop'){const p=await profile(this.shop,this.uid);if(p?.verified_at)await marketing(this.shop,this.uid,false);await this.send('Новини вимкнено. Повідомлення про замовлення залишаються.');return true;}
  if(head==='/subscribe'){const p=await profile(this.shop,this.uid);if(!p?.verified_at)await this.phonePrompt();else await this.newsPrompt();return true;}
  if(raw==='Про використання даних'){await this.bot.info('privacy');return true;}
  if(['/id','/help','/orders'].includes(head)||['Допомога','Про покупку','Мої замовлення'].includes(raw))return false;
  const s=await this.shop.session(this.uid),p=await profile(this.shop,this.uid);
  if(m.contact&&(s.step==='account_phone'||!p?.verified_at)){await verifyContact(this.shop,this.uid,m.contact);await this.shop.reset(this.uid);await this.bot.home();if(!p?.verified_at)await this.newsPrompt();return true;}
  if(s.step==='account_phone'){await this.phonePrompt();return true;}
  if(s.step==='admin_tracking'&&!head.startsWith('/')){await this.saveTracking(s,raw);return true;}
  if(s.step==='campaign_draft'&&!head.startsWith('/')){this.owner();const id=await draftCampaign(this.shop,raw,this.uid);await this.shop.reset(this.uid);const audience=await first(this.db,'SELECT COUNT(*) n FROM customers WHERE marketing=1 AND blocked=0');await this.send('<b>Попередній перегляд</b>\n\n'+esc(raw)+'\n\nПідписників: '+audience.n,kb([btn('Надіслати підписникам','campaignsend:'+id)],[btn('Скасувати','campaigncancel:'+id)]));return true;}
  if(head==='/news'){this.owner();await this.callback('campaignstart',[]);return true;}
  if(!p?.verified_at&&!adminIds(this.env).includes(this.uid)){await this.phonePrompt();return true;}
  return false;
 }
}
