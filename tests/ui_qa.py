"""Optional browser QA: API fixtures only; no live orders or Telegram messages."""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1];out=root/'.qa';out.mkdir(exist_ok=True)
html=(root/'src/admin.html').read_text();store=json.loads((root/'store.json').read_text());catalog=json.loads((root/'catalog.json').read_text());requests=[]
order={'id':12,'created_at':'2026-10-19T12:00:00.000Z','status':'confirmed','total':2380,'tracking':'','customer':{'name':'Олена Тестова','phone':'+380671234567'},'paid_kopecks':0}
report={'summary':{'orders':12,'ordered_uah':14280,'received_kopecks':952000,'refunded_kopecks':0,'expenses_kopecks':230000,'average_order_uah':1190,'repeat_buyers':2,'recorded_cash_difference':722000},'audience':{'subscribers':8},'notes':['Тестові дані інтерфейсу.','Суми замовлень і надходження обліковуються окремо.'],'statuses':[{'status':'confirmed','count':4},{'status':'shipped','count':8}],'products':[{'name':'Футболка «Серце-траєкторія»','quantity':8,'total_uah':9520}],'daily':[{'day':'2026-10-15','orders':3,'total_uah':3570},{'day':'2026-10-16','orders':5,'total_uah':5950},{'day':'2026-10-17','orders':4,'total_uah':4760}],'orders':[order]}
fixtures={'state':{'store':store,'catalog':catalog,'admin_count':1,'live_issues':[],'asset_keys':[],'payments':{'configured':False},'reports_ready':False},'analytics':report,'order':{'order':order,'balance':{'received':0,'refunded':0}}}
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
 for width in [1280,390]:
  page=browser.new_page(viewport={'width':width,'height':1000},device_scale_factor=1);errors=[];page.on('pageerror',lambda e: errors.append(str(e)))
  def route_handler(route):
   url=route.request.url
   if url.endswith('/setup'):route.fulfill(status=200,content_type='text/html',body=html);return
   action=url.rsplit('/',1)[-1];body=route.request.post_data_json or {};requests.append({'action':action,'body':body})
   data=fixtures.get(action,{'csv':'Номер,Сума\n12,2380'} if action=='export' else {'ok':True})
   route.fulfill(status=200,content_type='application/json',body=json.dumps(data,ensure_ascii=False))
  page.route('https://preview.formulove.test/**',route_handler);page.goto('https://preview.formulove.test/setup');page.locator('#key').fill('ui-test-key');page.locator('#load').click();page.wait_for_function("document.querySelectorAll('#metrics .metric').length===8")
  assert page.locator('#reportOrders tr').count()==1
  assert page.locator('#paymentsNote').inner_text().startswith('Онлайн-оплата ще не підключена')
  assert page.locator('#card_enabled').is_checked()
  assert page.evaluate('document.documentElement.scrollWidth<=window.innerWidth'),'Horizontal page overflow'
  page.locator('#sales').scroll_into_view_if_needed();page.screenshot(path=str(out/f'admin-{width}.png'))
  page.locator('[data-order="12"]').click();page.wait_for_function("document.getElementById('operationOrder').value==='12'")
  page.locator('#trackingNumber').fill('20450000000000');page.locator('#trackingSave').click();page.wait_for_function("document.getElementById('operationResult').textContent.includes('ТТН збережено')")
  page.locator('#expenseAmount').fill('120.50');page.locator('#expenseNote').fill('Реклама');page.locator('#expenseSave').click();page.wait_for_function("document.getElementById('expenseResult').textContent.includes('Витрату записано')")
  page.locator('#save').click();page.wait_for_function("document.getElementById('saveResult').textContent.includes('Збережено')");assert not errors,errors
  page.close();print(json.dumps({'width':width,'passed':True,'errors':errors}),flush=True)
 browser.close()
assert sum(r['action']=='tracking' for r in requests)==2
assert sum(r['action']=='expense' and r['body']['amount']==120.5 for r in requests)==2
for r in requests:
 if r['action']=='save':assert len(r['body']['catalog']['products'])==9 and r['body']['store']['card_enabled'] is True
print('Desktop and mobile: loading, layout, order, tracking, expense and settings passed using API fixtures.')
