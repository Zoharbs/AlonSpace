'use strict';
const express = require('express');
const ExcelJS = require('exceljs');
const db = require('../db');
const { isoMonth, electricityMonths, splitAgorot } = require('../utils/expenseMonths');
const router = express.Router();
const money = value => Number(value);
const validMoney = value => Number.isFinite(money(value)) && money(value) >= 0 && Math.abs(money(value)*100-Math.round(money(value)*100))<1e-6;
const monthsOfYear = year => Array.from({length:12},(_,i)=>`${year}-${String(i+1).padStart(2,'0')}`);
const redirect = (type,message) => '/expenses?'+type+'='+encodeURIComponent(message);
async function audit(client, entry, userId, action, oldValue) {
  await client.query('INSERT INTO expense_audit(entry_id,user_id,action,old_value,new_value) VALUES($1,$2,$3,$4,$5)', [entry.id,userId,action,oldValue?JSON.stringify(oldValue):null,JSON.stringify(entry)]);
}
router.use(async (req, res, next) => {
  try {
    if (!req.session?.userId) return res.redirect('/login');
    const r=await db.query('SELECT id,display_name FROM users WHERE id=$1 AND is_active=TRUE AND can_manage_expenses=TRUE',[req.session.userId]);
    if (!r.rowCount) return res.status(403).send('אין הרשאה לניהול הוצאות');
    req.expenseUser=r.rows[0];res.set('Cache-Control','no-store');next();
  } catch (error) {next(error);}
});
async function yearData(floor,year) {
  const categories=(await db.query('SELECT * FROM expense_categories WHERE floor=$1 AND is_active=TRUE ORDER BY sort_order,id',[floor])).rows;
  const entries=(await db.query("SELECT e.*,to_char(e.month,'YYYY-MM') AS month_key FROM expense_entries e JOIN expense_categories c ON c.id=e.category_id WHERE c.floor=$1 AND e.month>=make_date($2,1,1) AND e.month<make_date($2+1,1,1)",[floor,year])).rows;
  const entryMap={};for(const e of entries)entryMap[`${e.category_id}:${e.month_key}`]=e;
  return {categories,entryMap};
}
router.get('/',async (req,res,next)=>{
  try {
    const floor=Number(req.query.floor)===6?6:4,year=Number(req.query.year)||new Date().getFullYear();
    if(!Number.isInteger(year)||year<2020||year>2100)return res.sendStatus(400);
    const data=await yearData(floor,year);
    res.render('expenses/index',{...data,floor,year,months:monthsOfYear(year),user:req.expenseUser,error:req.query.error||'',success:req.query.success||'',csrfToken:req.csrfToken()});
  }catch(error){next(error);}
});
router.post('/categories',async(req,res,next)=>{
  try {
    const floor=Number(req.body.floor),name=String(req.body.name||'').trim(),amount=req.body.default_amount;
    if(![4,6].includes(floor)||!name||name.length>100||!validMoney(amount))return res.sendStatus(400);
    await db.query("INSERT INTO expense_categories(floor,name,default_amount) VALUES($1,$2,$3) ON CONFLICT(floor,name) DO UPDATE SET default_amount=EXCLUDED.default_amount",[floor,name,amount]);
    res.redirect(`/expenses?floor=${floor}&success=${encodeURIComponent('הקטגוריה נשמרה')}`);
  }catch(error){next(error);}
});
router.post('/estimate',async(req,res,next)=>{
  const client=await db.pool.connect();
  try {
    const id=Number(req.body.category_id),month=isoMonth(String(req.body.month||'')),amount=req.body.amount;
    if(!Number.isSafeInteger(id)||id<1||!validMoney(amount))return res.sendStatus(400);
    await client.query('BEGIN');
    const c=(await client.query('SELECT floor FROM expense_categories WHERE id=$1 AND is_active=TRUE',[id])).rows[0];
    if(!c){await client.query('ROLLBACK');return res.sendStatus(404);}
    const old=(await client.query('SELECT * FROM expense_entries WHERE category_id=$1 AND month=$2 FOR UPDATE',[id,month])).rows[0];
    if(old&&(old.status==='paid'||old.payment_id))throw Error('לא ניתן לשנות הערכה המקושרת לחשבון או תשלום');
    const entry=(await client.query(`INSERT INTO expense_entries(category_id,month,estimated_amount,updated_by) VALUES($1,$2,$3,$4) ON CONFLICT(category_id,month) DO UPDATE SET estimated_amount=EXCLUDED.estimated_amount,updated_by=EXCLUDED.updated_by,updated_at=NOW() RETURNING *`,[id,month,amount,req.expenseUser.id])).rows[0];
    await audit(client,entry,req.expenseUser.id,'estimate',old);
    await client.query('COMMIT');res.redirect(`/expenses?floor=${c.floor}&year=${month.slice(0,4)}&success=${encodeURIComponent('ההערכה נשמרה')}`);
  }catch(error){await client.query('ROLLBACK').catch(()=>{});res.redirect(redirect('error',error.message));}finally{client.release();}
});
router.post('/payment',async(req,res,next)=>{
  const client=await db.pool.connect();
  try {
    const id=Number(req.body.category_id),amount=req.body.amount,status=req.body.status;
    if(!Number.isSafeInteger(id)||id<1||!validMoney(amount)||money(amount)<=0||!['paid','estimated'].includes(status))return res.sendStatus(400);
    await client.query('BEGIN');
    const category=(await client.query('SELECT * FROM expense_categories WHERE id=$1 AND is_active=TRUE',[id])).rows[0];
    if(!category)throw Error('קטגוריה לא קיימת');
    let months, start=null,end=null;
    if(category.kind==='electricity'){
      start=String(req.body.period_start||'');end=String(req.body.period_end||'');months=electricityMonths(start,end);
    }else if(category.kind==='arnona'){
      months=[...new Set(String(req.body.months||'').split(',').map(x=>x.trim()).filter(Boolean))].sort();
      if(!months.length||months.length>24)throw Error('יש לבחור 1 עד 24 חודשים');
    }else months=[String(req.body.month||'')];
    const portions=splitAgorot(amount,months);
    // Serialize writes for a category, including initially empty months.
    await client.query('SELECT id FROM expense_categories WHERE id=$1 FOR UPDATE',[id]);
    const oldEntries=(await client.query('SELECT * FROM expense_entries WHERE category_id=$1 AND month=ANY($2::date[]) FOR UPDATE',[id,portions.map(p=>p.month)])).rows;
    if(oldEntries.some(e=>e.payment_id||e.status==='paid'))throw Error('קיים חשבון או תשלום בחודשים שנבחרו');
    const payment=(await client.query('INSERT INTO expense_payments(category_id,total_amount,status,period_start,period_end,payment_date,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id',[id,amount,status,start,end,status==='paid'?(req.body.payment_date||new Date().toISOString().slice(0,10)):null,req.expenseUser.id])).rows[0];
    for(const p of portions){
      const old=oldEntries.find(e=>e.month.toISOString?.().slice(0,10)===p.month || String(e.month).slice(0,10)===p.month);
      const estimate=old?old.estimated_amount:p.amount;
      const entry=(await client.query(`INSERT INTO expense_entries(category_id,month,estimated_amount,actual_amount,status,payment_id,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(category_id,month) DO UPDATE SET actual_amount=EXCLUDED.actual_amount,status=EXCLUDED.status,payment_id=EXCLUDED.payment_id,updated_by=EXCLUDED.updated_by,updated_at=NOW() RETURNING *`,[id,p.month,estimate,status==='paid'?p.amount:null,status,payment.id,req.expenseUser.id])).rows[0];
      await audit(client,entry,req.expenseUser.id,'payment',old);
    }
    await client.query('COMMIT');res.redirect(`/expenses?floor=${category.floor}&year=${portions[0].month.slice(0,4)}&success=${encodeURIComponent('החשבון נשמר')}`);
  }catch(error){await client.query('ROLLBACK').catch(()=>{});res.redirect(redirect('error',error.message));}finally{client.release();}
});
router.post('/finalize',async(req,res,next)=>{
  const client=await db.pool.connect();
  try {
    const id=Number(req.body.entry_id),amount=req.body.actual_amount;
    if(!Number.isSafeInteger(id)||id<1||!validMoney(amount))return res.sendStatus(400);
    await client.query('BEGIN');
    const old=(await client.query('SELECT * FROM expense_entries WHERE id=$1 FOR UPDATE',[id])).rows[0];
    if(!old||old.status!=='estimated'||old.payment_id)throw Error('ניתן לסגור רק הערכה בודדת');
    const entry=(await client.query("UPDATE expense_entries SET actual_amount=$2,status='paid',updated_by=$3,updated_at=NOW() WHERE id=$1 RETURNING *",[id,amount,req.expenseUser.id])).rows[0];
    await audit(client,entry,req.expenseUser.id,'finalize',old);
    await client.query('COMMIT');res.redirect(redirect('success','הסכום סומן כסופי'));
  }catch(error){await client.query('ROLLBACK').catch(()=>{});res.redirect(redirect('error',error.message));}finally{client.release();}
});
router.get('/export.xlsx',async(req,res,next)=>{
  try {
    const floor=Number(req.query.floor)===6?6:4,year=Number(req.query.year)||new Date().getFullYear();
    if(!Number.isInteger(year)||year<2020||year>2100)return res.sendStatus(400);
    const {categories,entryMap}=await yearData(floor,year),months=monthsOfYear(year);
    const wb=new ExcelJS.Workbook(),ws=wb.addWorksheet(`Floor ${floor}`);
    ws.addRow(['קטגוריה',...months]);
    for(const c of categories){const row=ws.addRow([c.name,...months.map(m=>{const e=entryMap[`${c.id}:${m}`];return Number(e?.status==='paid'?e.actual_amount:e?.estimated_amount??c.default_amount);})]);row.eachCell((cell,i)=>{if(i>1){const e=entryMap[`${c.id}:${months[i-2]}`];cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:e?.status==='paid'?'FFD4F4DC':'FFFFF2BD'}};cell.numFmt='₪#,##0.00';}});}
    ws.getColumn(1).width=30;for(let i=2;i<=13;i++)ws.getColumn(i).width=16;
    res.set('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');res.set('Content-Disposition',`attachment; filename="expenses-floor-${floor}-${year}.xlsx"`);
    await wb.xlsx.write(res);res.end();
  }catch(error){next(error);}
});
module.exports=router;
