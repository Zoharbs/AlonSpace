'use strict';
const express=require('express');
const db=require('../db');
const {isoMonth,electricityMonths,splitAgorot}=require('../utils/expenseMonths');
const router=express.Router();
router.use(async(req,res,next)=>{
 try{
  if(!req.session?.userId)return res.redirect('/login');
  const r=await db.query('SELECT id,display_name FROM users WHERE id=$1 AND is_active=TRUE AND can_manage_expenses=TRUE',[req.session.userId]);
  if(!r.rows.length)return res.status(403).send('אין הרשאה לניהול הוצאות');
  req.expenseUser=r.rows[0];res.set('Cache-Control','no-store');next();
 }catch(e){next(e)}
});
function notice(type,msg){return '/expenses?'+type+'='+encodeURIComponent(msg)}
function monthsOfYear(year){return Array.from({length:12},(_,i)=>`${year}-${String(i+1).padStart(2,'0')}`)}
router.get('/',async(req,res,next)=>{
 try{
  const floor=Number(req.query.floor)===6?6:4;
  const year=Number(req.query.year)||new Date().getFullYear();
  if(year<2020||year>2100)return res.status(400).send('שנה לא תקינה');
  const categories=(await db.query('SELECT * FROM expense_categories WHERE floor=$1 AND is_active=TRUE ORDER BY sort_order,id',[floor])).rows;
  const entries=(await db.query(`SELECT e.*,to_char(e.month,'YYYY-MM') AS month_key FROM expense_entries e JOIN expense_categories c ON c.id=e.category_id WHERE c.floor=$1 AND e.month >= make_date($2,1,1) AND e.month < make_date($2+1,1,1)`,[floor,year])).rows;
  const entryMap={};entries.forEach(e=>{entryMap[`${e.category_id}:${e.month_key}`]=e});
  res.render('expenses/index',{floor,year,categories,entryMap,months:monthsOfYear(year),user:req.expenseUser,error:req.query.error||'',success:req.query.success||'',csrfToken:req.csrfToken()});
 }catch(e){next(e)}
});
router.post('/categories',async(req,res,next)=>{
 try{
  const floor=Number(req.body.floor),name=String(req.body.name||'').trim();
  const amount=Number(req.body.default_amount);
  if(![4,6].includes(floor)||!name||name.length>100||!Number.isFinite(amount)||amount<0)return res.status(400).send('פרטי קטגוריה לא תקינים');
  await db.query(`INSERT INTO expense_categories(floor,name,default_amount) VALUES($1,$2,$3) ON CONFLICT(floor,name) DO UPDATE SET default_amount=EXCLUDED.default_amount`,[floor,name,amount]);
  res.redirect(`/expenses?floor=${floor}&success=${encodeURIComponent('הקטגוריה נשמרה')}`);
 }catch(e){next(e)}
});
router.post('/estimate',async(req,res,next)=>{
 try{
  const id=Number(req.body.category_id),month=isoMonth(String(req.body.month||'')),amount=Number(req.body.amount);
  if(!Number.isSafeInteger(id)||id<1||!Number.isFinite(amount)||amount<0||Math.abs(amount*100-Math.round(amount*100))>1e-7)return res.status(400).send('נתונים לא תקינים');
  const c=(await db.query('SELECT floor FROM expense_categories WHERE id=$1 AND is_active=TRUE',[id])).rows[0];if(!c)return res.sendStatus(404);
  const r=await db.query(`INSERT INTO expense_entries(category_id,month,estimated_amount,updated_by) VALUES($1,$2,$3,$4) ON CONFLICT(category_id,month) DO UPDATE SET estimated_amount=EXCLUDED.estimated_amount,updated_by=EXCLUDED.updated_by,updated_at=NOW() WHERE expense_entries.status='estimated' RETURNING id`,[id,month,amount,req.expenseUser.id]);
  if(!r.rowCount)return res.redirect(notice('error','הוצאה ששולמה לא ניתנת לדריסה דרך הערכה'));
  res.redirect(`/expenses?floor=${c.floor}&year=${month.slice(0,4)}&success=${encodeURIComponent('ההערכה נשמרה')}`);
 }catch(e){next(e)}
});
router.post('/payment',async(req,res,next)=>{
 const client=await db.pool.connect();
 try{
  const id=Number(req.body.category_id),total=Number(req.body.amount),status=req.body.status==='paid'?'paid':'estimated';
  const category=(await client.query('SELECT * FROM expense_categories WHERE id=$1 AND is_active=TRUE',[id])).rows[0];
  if(!category)return res.status(404).send('קטגוריה לא קיימת');
  let months=[];let start=null,end=null;
  if(category.kind==='electricity'){
   start=String(req.body.period_start||'');end=String(req.body.period_end||'');months=electricityMonths(start,end);
  }else if(category.kind==='arnona'){
   const selected=String(req.body.months||'').split(',').map(x=>x.trim()).filter(Boolean);
   months=[...new Set(selected)].sort();if(months.length<1||months.length>24)throw Error('יש לבחור בין חודש אחד ל־24 חודשים');
  }else{months=[String(req.body.month||'')];}
  const portions=splitAgorot(total,months);
  await client.query('BEGIN');
  const ids=portions.map(p=>p.month);
  const existing=await client.query("SELECT id FROM expense_entries WHERE category_id=$1 AND to_char(month,'YYYY-MM-DD')=ANY($2::text[]) FOR UPDATE",[id,ids]);
  // DATE::text is YYYY-MM-DD; explicit conflict guard prevents accidental overwrites.
  if(existing.rowCount){const conflicts=await client.query(`SELECT id FROM expense_entries WHERE category_id=$1 AND to_char(month,'YYYY-MM-DD')=ANY($2::text[]) AND (status='paid' OR payment_id IS NOT NULL)`,[id,ids]);if(conflicts.rowCount)throw Error('קיים תשלום משויך בחודשים שנבחרו. אין לדרוס תשלום קיים');}
  const payment=(await client.query('INSERT INTO expense_payments(category_id,total_amount,status,period_start,period_end,created_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING id',[id,total,status,start,end,req.expenseUser.id])).rows[0];
  for(const p of portions){
   const r=await client.query(`INSERT INTO expense_entries(category_id,month,estimated_amount,actual_amount,status,payment_id,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(category_id,month) DO UPDATE SET estimated_amount=EXCLUDED.estimated_amount,actual_amount=EXCLUDED.actual_amount,status=EXCLUDED.status,payment_id=EXCLUDED.payment_id,updated_by=EXCLUDED.updated_by,updated_at=NOW() RETURNING *`,[id,p.month,p.amount,status==='paid'?p.amount:null,status,payment.id,req.expenseUser.id]);
   await client.query('INSERT INTO expense_audit(entry_id,user_id,action,new_value) VALUES($1,$2,$3,$4)',[r.rows[0].id,req.expenseUser.id,'create_payment',JSON.stringify(r.rows[0])]);
  }
  await client.query('COMMIT');res.redirect(`/expenses?floor=${category.floor}&year=${portions[0].month.slice(0,4)}&success=${encodeURIComponent('התשלום נשמר')}`);
 }catch(e){await client.query('ROLLBACK').catch(()=>{});res.redirect(notice('error',e.message))}finally{client.release()}
});
router.post('/finalize',async(req,res,next)=>{
 try{
  const id=Number(req.body.entry_id),amount=Number(req.body.actual_amount);
  if(!Number.isSafeInteger(id)||!Number.isFinite(amount)||amount<0||Math.abs(amount*100-Math.round(amount*100))>1e-7)return res.sendStatus(400);
  const r=await db.query(`UPDATE expense_entries SET actual_amount=$2,status='paid',updated_by=$3,updated_at=NOW() WHERE id=$1 AND status='estimated' AND payment_id IS NULL RETURNING *`,[id,amount,req.expenseUser.id]);
  if(!r.rowCount)return res.redirect(notice('error','ניתן לסגור רק הערכה בודדת שאינה חלק מחשבון מחולק'));
  await db.query('INSERT INTO expense_audit(entry_id,user_id,action,new_value) VALUES($1,$2,$3,$4)',[id,req.expenseUser.id,'finalize',JSON.stringify(r.rows[0])]);
  res.redirect(notice('success','הסכום סומן כסופי'));
 }catch(e){next(e)}
});
module.exports=router;
