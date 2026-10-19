// FORMULOVE: optional private Google Sheets mirror. No credentials belong in this file.
function onOpen(){SpreadsheetApp.getUi().createMenu('FORMULOVE').addItem('Налаштувати','configureFORMULOVE').addItem('Оновити з бота','syncFORMULOVE').addItem('Увімкнути оновлення щогодини','scheduleFORMULOVE').addToUi();}
function configureFORMULOVE(){
 const ui=SpreadsheetApp.getUi();const url=ui.prompt('Адреса Worker','Наприклад: https://botluna.dmitriyua9.workers.dev',ui.ButtonSet.OK_CANCEL);if(url.getSelectedButton()!==ui.Button.OK)return;
 const base=url.getResponseText().trim().replace(/\/$/,'');if(!/^https:\/\/[a-z0-9.-]+(?:\.workers\.dev)?$/.test(base))throw Error('Потрібна HTTPS-адреса Worker без додаткового шляху.');
 const key=ui.prompt('REPORT_KEY','Окремий ключ звітів із Secrets Cloudflare. Не BOT_TOKEN і не SETUP_KEY.',ui.ButtonSet.OK_CANCEL);if(key.getSelectedButton()!==ui.Button.OK)return;if(key.getResponseText().trim().length<32)throw Error('REPORT_KEY має містити мінімум 32 символи.');
 PropertiesService.getScriptProperties().setProperties({FORMULOVE_URL:base,FORMULOVE_REPORT_KEY:key.getResponseText().trim(),FORMULOVE_SHEET_ID:SpreadsheetApp.getActive().getId()});ui.alert('Налаштування збережено. Синхронізуються лише аркуші FORMULOVE_*. Не використовуйте їх для ручних записів. Таблиця має залишатися приватною.');
}
function syncFORMULOVE(){
 const lock=LockService.getScriptLock();if(!lock.tryLock(3000))return;
 try{
  const p=PropertiesService.getScriptProperties(),base=p.getProperty('FORMULOVE_URL'),key=p.getProperty('FORMULOVE_REPORT_KEY'),sheetId=p.getProperty('FORMULOVE_SHEET_ID');if(!base||!key||!sheetId)throw Error('Спершу виконайте «Налаштувати».');
  const book=SpreadsheetApp.openById(sheetId),to=new Date().toISOString().slice(0,10),from=new Date(Date.now()-365*86400000).toISOString().slice(0,10),data={};
  const types={orders:'Замовлення',items:'Товари',money:'Гроші',expenses:'Витрати'};
  Object.keys(types).forEach(function(type){
   const response=UrlFetchApp.fetch(base+'/reports/export',{method:'post',contentType:'application/json',headers:{Authorization:'Bearer '+key},payload:JSON.stringify({type:type,from:from,to:to}),muteHttpExceptions:true});if(response.getResponseCode()!==200)throw Error('Не вдалося отримати звіт '+type+'. Перевірте REPORT_KEY і адресу Worker.');
   const rows=Utilities.parseCsv(response.getContentText('UTF-8').replace(/^\uFEFF/,''));if(!rows.length)return;
   const numeric=['Сума грн','Ціна грн','Кількість одиниць або комплектів'];rows.slice(1).forEach(function(row){row.forEach(function(value,column){if(numeric.indexOf(rows[0][column])!==-1&&value!==''&&isFinite(Number(value)))row[column]=Number(value);});});
   data[type]=rows;const name='FORMULOVE_'+types[type],sheet=book.getSheetByName(name)||book.insertSheet(name);if(sheet.getMaxRows()<rows.length)sheet.insertRowsAfter(sheet.getMaxRows(),rows.length-sheet.getMaxRows());if(sheet.getMaxColumns()<rows[0].length)sheet.insertColumnsAfter(sheet.getMaxColumns(),rows[0].length-sheet.getMaxColumns());sheet.clearContents();sheet.getRange(1,1,rows.length,rows[0].length).setValues(rows);sheet.setFrozenRows(1);sheet.getRange(1,1,1,rows[0].length).setFontWeight('bold').setBackground('#f2eee7');
  });
  const orders=(data.orders||[]).slice(1),money=(data.money||[]).slice(1),expenses=(data.expenses||[]).slice(1),valid=orders.filter(function(r){return r[2]!=='cancelled';});
  const sum=function(rows,column){return rows.reduce(function(s,r){return s+Number(r[column]||0);},0);};const receipts=sum(money.filter(function(r){return r[3]==='receipt';}),4),refunds=sum(money.filter(function(r){return r[3]==='refund';}),4),costs=sum(expenses,3);
  const overview=[['FORMULOVE · дзеркало бази',new Date().toISOString()],['Період UTC',from+' — '+to],['Live-замовлень',orders.length],['Сума без скасованих, грн',sum(valid,3)],['Отримані оплати, грн',receipts],['Повернення, грн',refunds],['Внесені витрати, грн',costs],['Різниця надходжень і внесених витрат, грн',receipts-refunds-costs],['Примітка','Це не чистий прибуток. Усі витрати треба внести в панелі. Дати оплат відрізняються від дат замовлень.'],['Джерело','Cloudflare D1. До 10 000 рядків кожного звіту за період.']];
  const summary=book.getSheetByName('FORMULOVE_Огляд')||book.insertSheet('FORMULOVE_Огляд');summary.clearContents();summary.getRange(1,1,overview.length,2).setValues(overview);summary.setColumnWidth(1,390);summary.setColumnWidth(2,520);summary.getRange(1,1,overview.length,2).setWrap(true);
 }finally{lock.releaseLock();}
}
function scheduleFORMULOVE(){ScriptApp.getProjectTriggers().filter(function(t){return t.getHandlerFunction()==='syncFORMULOVE';}).forEach(function(t){ScriptApp.deleteTrigger(t);});ScriptApp.newTrigger('syncFORMULOVE').timeBased().everyHours(1).create();}
