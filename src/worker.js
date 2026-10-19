import { DEFAULT_CATALOG } from './defaults.js';
import { SETUP_HTML } from './ui.js';
import { Shop,ShopError,initialize,sha,adminIds,first,all,run,stmt,epoch,stamp,telegram,publicError,onlineReady } from './core.js';
import { Bot,drain } from './bot.js';
import {analytics,accountingCSV,expense,pennies,recordReceipt,recordRefund,balances,drainCampaigns} from './commerce.js';
import {monoHook,syncInvoice,pollPayments} from './payments.js';

const security={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY'};
function json(value,status=200){return Response.json(value,{status,headers:security});}
function equalSecret(a,b){if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;let out=0;for(let i=0;i<a.length;i++)out|=a.charCodeAt(i)^b.charCodeAt(i);return out===0;}
export async function webhookSecret(env){if(env.WEBHOOK_SECRET){if(!/^[A-Za-z0-9_-]{16,256}$/.test(env.WEBHOOK_SECRET))throw new ShopError('WEBHOOK_SECRET має бути 16–256 латинських символів/цифр/_/-.');return env.WEBHOOK_SECRET;}return sha('FORMULOVE:telegram:'+env.SETUP_KEY);}
function environmentIssues(env){const issues=[];if(!env.DB)issues.push('D1 binding DB');if(typeof env.SETUP_KEY!=='string'||env.SETUP_KEY.length<32)issues.push('SETUP_KEY мінімум 32 символи');if(!/^\d+:[A-Za-z0-9_-]{20,}$/.test(env.BOT_TOKEN||''))issues.push('BOT_TOKEN від BotFather');return issues;}
export async function setup(request,env,url){
 if(request.method!=='POST')return json({error:'Використовуйте POST.'},405);
 if(!env.SETUP_KEY||env.SETUP_KEY.length<32)return json({error:'Додайте Secret SETUP_KEY у Cloudflare (мінімум 32 символи).'},503);
 if(!equalSecret(request.headers.get('Authorization'),'Bearer '+env.SETUP_KEY))return json({error:'Невірний ключ доступу.'},401);
 const origin=request.headers.get('Origin');if(origin&&origin!==url.origin)return json({error:'Запит має походити з цієї самої сторінки.'},403);
 if(!request.headers.get('Content-Type')?.startsWith('application/json'))return json({error:'Потрібен application/json.'},415);
 const raw=await request.text();if(raw.length>200000)return json({error:'Запит завеликий.'},413);let body;try{body=JSON.parse(raw)}catch{return json({error:'Некоректний JSON.'},400)}
 if(!env.DB)return json({error:'Додайте D1 binding із назвою DB.'},503);
 const action=url.pathname.slice('/setup/'.length);
 try{
  if(action==='init'){await initialize(env.DB);return json({ok:true,note:'Базу підготовлено без видалення чинних даних.'});}
  const shop=await new Shop(env).load();
  if(action==='state')return json({store:shop.store,catalog:{currency:'UAH',categories:shop.categories,products:Object.values(shop.products)},admin_count:adminIds(shop.env).length,live_issues:shop.liveIssues(),asset_keys:Object.keys(shop.assets),payments:{provider:'monobank',configured:onlineReady(env)},reports_ready:!!env.REPORT_KEY&&env.REPORT_KEY.length>=32});
  if(action==='save'){await shop.saveConfig(body.store,body.catalog);return json({ok:true});}
  if(action==='analytics')return json(await analytics(shop,body));
  if(action==='export')return json({csv:await accountingCSV(shop,body.type,body)});
  if(action==='expense'){await expense(shop,{amount:pennies(body.amount),category:body.category,note:body.note||'',reference:String(body.reference||'')});return json({ok:true});}
  if(action==='order'){const order=await shop.order(Number(body.id));if(!order)throw new ShopError('Замовлення не знайдено.');return json({order,balance:await balances(shop,order.id)});}
  if(action==='tracking'){
   const order=await shop.order(Number(body.id)),tracking=String(body.tracking||'');if(!order||!/^\d{14}$/.test(tracking))throw new ShopError('Перевірте замовлення та 14 цифр ТТН.');
   if(order.status==='shipped')await env.DB.batch([stmt(env.DB,"UPDATE orders SET tracking=? WHERE id=? AND status='shipped'",[tracking,order.id]),stmt(env.DB,"INSERT INTO outbox(chat_id,order_id,kind) VALUES(?,?,'buyer_status')",[order.user_id,order.id])]);
   else await shop.status(order.id,'shipped',adminIds(shop.env)[0],{tracking});return json({ok:true});
  }
  if(action==='money'){
   if(body.confirmed!==true)throw new ShopError('Підтвердіть, що гроші фактично отримано або повернуто.');
   const id=Number(body.id);if(body.kind==='receipt')await recordReceipt(shop,id,adminIds(shop.env)[0],'manual:'+id);
   else if(body.kind==='refund'){if(typeof body.reference!=='string'||body.reference.length<8||body.reference.length>100)throw new ShopError('Перевірте ідентифікатор запису.');await recordRefund(shop,id,pennies(body.amount),body.reference);}
   else throw new ShopError('Оберіть оплату або повернення.');return json({ok:true});
  }
  if(['check','connect'].includes(action)){
   const issues=environmentIssues(env);if(issues.length)throw new ShopError('Заповніть: '+issues.join('; '));const me=await telegram(env,'getMe',{}),info=await telegram(env,'getWebhookInfo',{});
   if(action==='check'){const queued=await first(env.DB,"SELECT COUNT(*) n FROM outbox WHERE state!='done'");return json({username:me.username,webhook_url:info.url,pending:info.pending_update_count||0,outbox_pending:queued.n,note:'Telegram не перевіряє фактичну оплату або доставку. Останню помилку підключення дивіться в BotFather/логах без публікації токена.'});}
   if(shop.store.mode==='live'&&shop.liveIssues().length)throw new ShopError('Завершіть налаштування live: '+shop.liveIssues().join('; '));
   const endpoint=url.origin+'/telegram/webhook';if(info.url&&info.url!==endpoint&&body.replace!==true)return json({error:'У бота вже є інше webhook-підключення. Якщо потрібно замінити, поставте відповідну позначку.'},409);
   await telegram(env,'setWebhook',{url:endpoint,secret_token:await webhookSecret(env),max_connections:1,allowed_updates:['message','callback_query'],drop_pending_updates:false});
   await telegram(env,'setMyCommands',{commands:[['start','Вітання та меню'],['catalog','Каталог FORMULOVE'],['all','Усі моделі з фото'],['cart','Мій кошик'],['orders','Мої замовлення'],['profile','Мій профіль'],['unsubscribe','Вимкнути новини'],['help','Допомога'],['cancel','Скасувати оформлення'],['id','Мій Telegram ID']].map(([command,description])=>({command,description}))});
   await run(env.DB,"INSERT INTO settings VALUES('bot_username',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",[me.username]);
   return json({ok:true,username:me.username,note:shop.store.mode==='demo'?'Працює demo. Нічого не сплачуйте. Внесіть свій числовий ID з команди /id у поле власника в панелі.':'Підключення збережено. Виконайте контрольне замовлення.'});
  }
  return json({error:'Дію не знайдено.'},404);
 }catch(error){if(error instanceof ShopError)return json({error:error.message},400);if(error?.code!==undefined)return json({error:'Telegram не відповів (код '+error.code+'). Перевірте токен і повторіть запит.'},502);return json({error:'Не вдалося виконати запит. Якщо це перший запуск, спершу натисніть «Підготувати базу».'},500);}
}

export async function handleWebhook(request,env){
 if(request.method!=='POST')return json({error:'Method not allowed'},405);
 if(environmentIssues(env).length)return json({error:'Bot is not configured'},503);
 if(!equalSecret(request.headers.get('X-Telegram-Bot-Api-Secret-Token'),await webhookSecret(env)))return json({error:'Forbidden'},403);
 const raw=await request.text();if(raw.length>65536)return json({error:'Update too large'},413);let update;try{update=JSON.parse(raw)}catch{return json({error:'Invalid JSON'},400)}
 if(!Number.isSafeInteger(update.update_id)||update.update_id<0)return json({error:'Invalid update id'},400);
 const now=epoch();
 const claim=await first(env.DB,"INSERT INTO updates(id,state,lock_until,created_at) VALUES(?,'processing',?,?) ON CONFLICT(id) DO UPDATE SET state='processing',lock_until=excluded.lock_until WHERE updates.state!='done' AND updates.lock_until<? RETURNING id",[update.update_id,now+120,now,now]);
 if(!claim){const old=await first(env.DB,'SELECT state FROM updates WHERE id=?',[update.update_id]);return old?.state==='done'?json({ok:true,duplicate:true}):json({error:'Update processing'},503);}
 try{
  const shop=await new Shop({...env,PUBLIC_BASE_URL:new URL(request.url).origin}).load();const uid=update.callback_query?.from?.id??update.message?.from?.id;
  if(Number.isSafeInteger(uid)&&uid>0){const bot=new Bot(shop,uid,update.update_id);try{await bot.handle(update)}catch(error){if(error instanceof ShopError||/STOCK_CHANGED|CART_LIMIT|PRICE_CHANGED|CART_CHANGED|CONFIG_CHANGED/.test(String(error?.message))){await bot.send(publicError(error));}else throw error;}}
  await run(env.DB,"UPDATE updates SET state='done',lock_until=0 WHERE id=?",[update.update_id]);
  // Best-effort immediate delivery; every order already has a durable outbox row.
  try{await drain(shop,3)}catch{}
  return json({ok:true});
 }catch{await run(env.DB,'UPDATE updates SET lock_until=0 WHERE id=?',[update.update_id]);return json({error:'Temporary processing failure'},503);}
}

export default {
 async fetch(request,env){
  const url=new URL(request.url);
  if(url.pathname==='/reports/export'){
   if(request.method!=='POST')return json({error:'Method not allowed'},405);
   if(!env.REPORT_KEY||env.REPORT_KEY.length<32||!equalSecret(request.headers.get('Authorization'),'Bearer '+env.REPORT_KEY))return json({error:'Forbidden'},403);
   try{const raw=await request.text();if(raw.length>4096)return json({error:'Request too large'},413);const data=JSON.parse(raw),shop=await new Shop(env).load();return new Response(await accountingCSV(shop,data.type,data),{headers:{...security,'Content-Type':'text/csv; charset=utf-8'}});}catch{return json({error:'Cannot export this report'},400);}
  }
  if(url.pathname.startsWith('/payments/mono/')){
   if(request.method!=='POST')return json({error:'Method not allowed'},405);
   if(!onlineReady(env)||!env.SETUP_KEY||!equalSecret(url.pathname,'/payments/mono/'+await monoHook(env)))return json({error:'Forbidden'},403);
   try{const raw=await request.text();if(raw.length>16384)return json({error:'Request too large'},413);const body=JSON.parse(raw);if(!/^[-\w]{1,80}$/.test(body.invoiceId||''))return json({error:'Invalid invoice'},400);const shop=await new Shop(env).load(),row=await first(env.DB,'SELECT order_id FROM payment_invoices WHERE invoice_id=?',[body.invoiceId]);if(row)await syncInvoice(shop,row.order_id);return json({ok:true});}catch{return json({error:'Payment status needs retry'},503);}
  }
  if(url.pathname==='/payment-return')return new Response('<!doctype html><html lang="uk"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>FORMULOVE — оплата</title><body style="font:18px/1.6 system-ui;max-width:600px;margin:60px auto;padding:24px"><h1>FORMULOVE</h1><p>Поверніться в бот → Мої замовлення → Перевірити оплату.</p><p>Статус оновлюється після відповіді банку.</p></body></html>',{headers:{...security,'Content-Type':'text/html; charset=utf-8'}});
  if(url.pathname==='/setup'&&request.method==='GET')return new Response(SETUP_HTML,{headers:{...security,'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':"default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'"}});
  if(url.pathname.startsWith('/setup/'))return setup(request,env,url);
  if(url.pathname==='/telegram/webhook')return handleWebhook(request,env);
  if(url.pathname==='/health')return json({service:'FORMULOVE',status:'running'});
  if(url.pathname==='/'&&request.method==='GET')return new Response('<!doctype html><html lang="uk"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>FORMULOVE</title><body style="font:17px/1.6 system-ui;background:#f7f4ee;color:#222;max-width:620px;margin:70px auto;padding:25px"><h1 style="letter-spacing:5px">FORMULOVE</h1><p>Одяг з вишивкою для фанатів Формули 1.</p><p>Це технічна адреса Telegram-бота. Для покупки відкрийте посилання на бота зі сторінки FORMULOVE.</p><a href="/setup" style="color:#a8202a">Панель власника</a></body></html>',{headers:{...security,'Content-Type':'text/html; charset=utf-8'}});
  return json({error:'Not found'},404);
 },
 async scheduled(controller,env,ctx){
  ctx.waitUntil((async()=>{if(!env.DB)return;try{const shop=await new Shop(env).load();await pollPayments(shop,1);await drain(shop,2);await drainCampaigns(shop,8);await env.DB.batch([stmt(env.DB,"DELETE FROM updates WHERE state='done' AND created_at<?",[epoch()-7*86400]),stmt(env.DB,'DELETE FROM mutations WHERE created_at<?',[epoch()-7*86400])]);}catch{console.log('FORMULOVE scheduled delivery needs retry');}})());
 }
};
