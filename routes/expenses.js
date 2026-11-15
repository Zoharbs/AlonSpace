'use strict';
const express = require('express');
const ExcelJS = require('exceljs');
const db = require('../db');
const { isoMonth, electricityMonths, splitAgorot } = require('../utils/expenseMonths');
const router = express.Router();
const monthsOfYear = year => Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);
const notice = (type, message, floor = 4, year = new Date().getFullYear()) => `/expenses?floor=${floor}&year=${year}&${type}=${encodeURIComponent(message)}`;
const validMoney = value => value !== '' && value !== undefined && value !== null && Number.isFinite(Number(value)) && Number(value) >= 0 && Math.abs(Number(value) * 100 - Math.round(Number(value) * 100)) < 1e-6;
const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value)) && !Number.isNaN(Date.parse(value)) && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
async function audit(client, entry, userId, action, oldValue) {
  await client.query('INSERT INTO expense_audit(entry_id,user_id,action,old_value,new_value) VALUES($1,$2,$3,$4,$5)', [entry.id, userId, action, oldValue ? JSON.stringify(oldValue) : null, JSON.stringify(entry)]);
}
async function transaction(callback) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
router.use(async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    if (!req.session?.userId) return res.redirect('/login');
    const result = await db.query('SELECT id,display_name FROM users WHERE id=$1 AND is_active=TRUE AND can_manage_expenses=TRUE', [req.session.userId]);
    if (!result.rowCount) return res.status(403).send('אין הרשאה לניהול הוצאות');
    req.expenseUser = result.rows[0];
    next();
  } catch (error) { next(error); }
});
async function yearData(floor, year) {
  const categories = (await db.query('SELECT * FROM expense_categories WHERE floor=$1 AND is_active=TRUE ORDER BY sort_order,id', [floor])).rows;
  const entries = (await db.query("SELECT e.*,to_char(e.month,'YYYY-MM') AS month_key FROM expense_entries e JOIN expense_categories c ON c.id=e.category_id WHERE c.floor=$1 AND e.month>=make_date($2,1,1) AND e.month<make_date($2+1,1,1)", [floor, year])).rows;
  const entryMap = {};
  for (const entry of entries) entryMap[`${entry.category_id}:${entry.month_key}`] = entry;
  return { categories, entryMap };
}
function selection(req) {
  const floor = req.query.floor === undefined ? 4 : Number(req.query.floor);
  const year = req.query.year === undefined ? new Date().getFullYear() : Number(req.query.year);
  if (![4, 6].includes(floor) || !Number.isInteger(year) || year < 2020 || year > 2100) return null;
  return { floor, year };
}
router.get('/', async (req, res, next) => {
  try {
    const selected = selection(req);
    if (!selected) return res.sendStatus(400);
    const data = await yearData(selected.floor, selected.year);
    const pendingPayments = (await db.query("SELECT p.id,p.total_amount,c.name,to_char(p.created_at,'YYYY-MM-DD') AS created_date FROM expense_payments p JOIN expense_categories c ON c.id=p.category_id WHERE c.floor=$1 AND p.status='estimated' AND p.cancelled_at IS NULL AND EXISTS (SELECT 1 FROM expense_entries e WHERE e.payment_id=p.id AND e.month>=make_date($2,1,1) AND e.month<make_date($2+1,1,1)) ORDER BY p.created_at DESC", [selected.floor, selected.year])).rows;
    res.render('expenses/index', { ...data, pendingPayments, ...selected, months: monthsOfYear(selected.year), user: req.expenseUser, error: req.query.error || '', success: req.query.success || '', csrfToken: req.csrfToken() });
  } catch (error) { next(error); }
});
router.post('/categories', async (req, res, next) => {
  try {
    const floor = Number(req.body.floor), name = String(req.body.name || '').trim(), amount = req.body.default_amount;
    if (![4, 6].includes(floor) || !name || name.length > 100 || !validMoney(amount)) return res.sendStatus(400);
    await db.query('INSERT INTO expense_categories(floor,name,default_amount) VALUES($1,$2,$3) ON CONFLICT(floor,name) DO UPDATE SET default_amount=EXCLUDED.default_amount', [floor, name, amount]);
    res.redirect(notice('success', 'הקטגוריה נשמרה', floor));
  } catch (error) { next(error); }
});
router.post('/estimate', async (req, res, next) => {
  try {
    const id = Number(req.body.category_id), month = isoMonth(String(req.body.month || '')), amount = req.body.amount;
    if (!Number.isSafeInteger(id) || id < 1 || !validMoney(amount)) return res.sendStatus(400);
    const floor = await transaction(async client => {
      const category = (await client.query('SELECT floor FROM expense_categories WHERE id=$1 AND is_active=TRUE', [id])).rows[0];
      if (!category) throw Error('קטגוריה לא קיימת');
      const old = (await client.query('SELECT * FROM expense_entries WHERE category_id=$1 AND month=$2 FOR UPDATE', [id, month])).rows[0];
      if (old && (old.status === 'paid' || old.payment_id)) throw Error('לא ניתן לשנות הערכה המקושרת לחשבון או תשלום');
      const entry = (await client.query('INSERT INTO expense_entries(category_id,month,estimated_amount,updated_by) VALUES($1,$2,$3,$4) ON CONFLICT(category_id,month) DO UPDATE SET estimated_amount=EXCLUDED.estimated_amount,updated_by=EXCLUDED.updated_by,updated_at=NOW() RETURNING *', [id, month, amount, req.expenseUser.id])).rows[0];
      await audit(client, entry, req.expenseUser.id, 'estimate', old);
      return category.floor;
    });
    res.redirect(notice('success', 'ההערכה נשמרה', floor, Number(month.slice(0, 4))));
  } catch (error) { res.redirect(notice('error', error.message)); }
});
router.post('/payment', async (req, res, next) => {
  try {
    const id = Number(req.body.category_id), amount = req.body.amount, status = req.body.status;
    if (!Number.isSafeInteger(id) || id < 1 || !validMoney(amount) || Number(amount) <= 0 || !['paid', 'estimated'].includes(status)) return res.sendStatus(400);
    const paymentDate = status === 'paid' ? String(req.body.payment_date || new Date().toISOString().slice(0, 10)) : null;
    if (paymentDate && !validDate(paymentDate)) return res.status(400).send('תאריך תשלום לא תקין');
    const result = await transaction(async client => {
      const category = (await client.query('SELECT * FROM expense_categories WHERE id=$1 AND is_active=TRUE FOR UPDATE', [id])).rows[0];
      if (!category) throw Error('קטגוריה לא קיימת');
      let months, start = null, end = null;
      if (category.kind === 'electricity') {
        start = String(req.body.period_start || ''); end = String(req.body.period_end || '');
        months = electricityMonths(start, end);
      } else if (category.kind === 'arnona') {
        months = [...new Set(String(req.body.months || '').split(',').map(x => x.trim()).filter(Boolean))].sort();
        if (!months.length || months.length > 24) throw Error('יש לבחור 1 עד 24 חודשים');
      } else months = [String(req.body.month || '')];
      const portions = splitAgorot(amount, months);
      const oldEntries = (await client.query('SELECT * FROM expense_entries WHERE category_id=$1 AND month=ANY($2::date[]) FOR UPDATE', [id, portions.map(p => p.month)])).rows;
      if (oldEntries.some(e => e.payment_id || e.status === 'paid')) throw Error('קיים חשבון או תשלום בחודשים שנבחרו');
      const payment = (await client.query('INSERT INTO expense_payments(category_id,total_amount,status,period_start,period_end,payment_date,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id', [id, amount, status, start, end, paymentDate, req.expenseUser.id])).rows[0];
      for (const portion of portions) {
        const old = oldEntries.find(e => String(e.month instanceof Date ? e.month.toISOString().slice(0, 10) : e.month).slice(0, 10) === portion.month);
        const estimate = old ? old.estimated_amount : portion.amount;
        const entry = (await client.query('INSERT INTO expense_entries(category_id,month,estimated_amount,actual_amount,status,payment_id,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(category_id,month) DO UPDATE SET actual_amount=EXCLUDED.actual_amount,status=EXCLUDED.status,payment_id=EXCLUDED.payment_id,updated_by=EXCLUDED.updated_by,updated_at=NOW() RETURNING *', [id, portion.month, estimate, status === 'paid' ? portion.amount : null, status, payment.id, req.expenseUser.id])).rows[0];
        await audit(client, entry, req.expenseUser.id, 'payment', old);
      }
      return { floor: category.floor, year: Number(portions[0].month.slice(0, 4)) };
    });
    res.redirect(notice('success', 'החשבון נשמר', result.floor, result.year));
  } catch (error) { res.redirect(notice('error', error.message)); }
});
router.post('/finalize', async (req, res, next) => {
  try {
    const id = Number(req.body.entry_id), amount = req.body.actual_amount;
    if (!Number.isSafeInteger(id) || id < 1 || !validMoney(amount)) return res.sendStatus(400);
    const floor = await transaction(async client => {
      const old = (await client.query('SELECT * FROM expense_entries WHERE id=$1 FOR UPDATE', [id])).rows[0];
      if (!old || old.status !== 'estimated' || old.payment_id) throw Error('ניתן לסגור רק הערכה בודדת');
      const entry = (await client.query("UPDATE expense_entries SET actual_amount=$2,status='paid',updated_by=$3,updated_at=NOW() WHERE id=$1 RETURNING *", [id, amount, req.expenseUser.id])).rows[0];
      await audit(client, entry, req.expenseUser.id, 'finalize', old);
      const category = (await client.query('SELECT floor FROM expense_categories WHERE id=$1', [entry.category_id])).rows[0];
      return category.floor;
    });
    res.redirect(notice('success', 'הסכום סומן כסופי', floor));
  } catch (error) { res.redirect(notice('error', error.message)); }
});
router.post('/finalize-payment', async (req, res, next) => {
  try {
    const paymentId = Number(req.body.payment_id);
    if (!Number.isSafeInteger(paymentId) || paymentId < 1) return res.sendStatus(400);
    const paymentDate = String(req.body.payment_date || new Date().toISOString().slice(0, 10));
    if (!validDate(paymentDate)) return res.sendStatus(400);
    const result = await transaction(async client => {
      const payment = (await client.query('SELECT * FROM expense_payments WHERE id=$1 FOR UPDATE', [paymentId])).rows[0];
      if (!payment || payment.status !== 'estimated' || payment.cancelled_at) throw Error('החשבון אינו ממתין לתשלום');
      const entries = (await client.query('SELECT * FROM expense_entries WHERE payment_id=$1 ORDER BY month FOR UPDATE', [paymentId])).rows;
      if (!entries.length || entries.some(e => e.status !== 'estimated')) throw Error('רשומות החשבון אינן תקינות');
      const portions = splitAgorot(payment.total_amount, entries.map(e => e.month instanceof Date ? e.month.toISOString().slice(0, 7) : String(e.month).slice(0, 7)));
      await client.query("UPDATE expense_payments SET status='paid',payment_date=$2 WHERE id=$1", [paymentId, paymentDate]);
      for (let i = 0; i < entries.length; i++) {
        const old = entries[i];
        const entry = (await client.query("UPDATE expense_entries SET actual_amount=$2,status='paid',updated_by=$3,updated_at=NOW() WHERE id=$1 RETURNING *", [old.id, portions[i].amount, req.expenseUser.id])).rows[0];
        await audit(client, entry, req.expenseUser.id, 'finalize_payment', old);
      }
      const category = (await client.query('SELECT floor FROM expense_categories WHERE id=$1', [payment.category_id])).rows[0];
      return { floor: category.floor, year: Number(portions[0].month.slice(0, 4)) };
    });
    res.redirect(notice('success', 'החשבון סומן כשולם', result.floor, result.year));
  } catch (error) { res.redirect(notice('error', error.message)); }
});
router.get('/export.xlsx', async (req, res, next) => {
  try {
    const selected = selection(req);
    if (!selected) return res.sendStatus(400);
    const { floor, year } = selected;
    const { categories, entryMap } = await yearData(floor, year), months = monthsOfYear(year);
    const wb = new ExcelJS.Workbook(), ws = wb.addWorksheet(`Floor ${floor}`);
    ws.addRow(['קטגוריה', ...months]);
    for (const c of categories) {
      const row = ws.addRow([c.name, ...months.map(m => { const e = entryMap[`${c.id}:${m}`]; return Number(e?.status === 'paid' ? e.actual_amount : e?.estimated_amount ?? c.default_amount); })]);
      row.eachCell((cell, i) => { if (i > 1) { const e = entryMap[`${c.id}:${months[i - 2]}`]; cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: e?.status === 'paid' ? 'FFD4F4DC' : 'FFFFF2BD' } }; cell.numFmt = '₪#,##0.00'; } });
    }
    ws.getColumn(1).width = 30; for (let i = 2; i <= 13; i++) ws.getColumn(i).width = 16;
    res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.set('Content-Disposition', `attachment; filename="expenses-floor-${floor}-${year}.xlsx"`);
    await wb.xlsx.write(res); res.end();
  } catch (error) { next(error); }
});
module.exports = router;
