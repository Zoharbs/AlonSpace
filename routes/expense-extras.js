'use strict';
const express = require('express');
const db = require('../db');
const router = express.Router();

router.use(async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    if (!req.session?.userId) return res.redirect('/login');
    const user = await db.query('SELECT id FROM users WHERE id=$1 AND is_active=TRUE AND can_manage_expenses=TRUE', [req.session.userId]);
    if (!user.rowCount) return res.sendStatus(403);
    next();
  } catch (error) { next(error); }
});

const getYear = value => {
  const year = value === undefined ? new Date().getFullYear() : Number(value);
  if (!Number.isInteger(year) || year < 2020 || year > 2100) throw new Error('שנה לא תקינה');
  return year;
};

router.get('/overview', async (req, res, next) => {
  try {
    const year = getYear(req.query.year);
    const result = await db.query(`
      SELECT c.floor, c.id AS category_id, c.name, c.default_amount,
             EXTRACT(MONTH FROM e.month)::int AS month_number,
             e.estimated_amount, e.actual_amount, e.status
      FROM expense_categories c
      LEFT JOIN expense_entries e ON e.category_id=c.id
        AND e.month>=make_date($1,1,1) AND e.month<make_date($1+1,1,1)
      WHERE c.floor IN (4,6) AND c.is_active=TRUE
      ORDER BY c.floor,c.sort_order,c.id,e.month`, [year]);
    const months = Array.from({length:12}, (_,i) => i+1);
    const floors = [4,6].map(floor => {
      const categories = new Map();
      for (const row of result.rows.filter(r => r.floor === floor)) {
        if (!categories.has(row.category_id)) categories.set(row.category_id, {id:row.category_id,name:row.name,defaultAmount:Number(row.default_amount),entries:{}});
        if (row.month_number) categories.get(row.category_id).entries[row.month_number] = row;
      }
      const items = [...categories.values()];
      const totals = months.map(month => items.reduce((acc, item) => {
        const entry = item.entries[month];
        const estimated = entry ? Number(entry.estimated_amount) : item.defaultAmount;
        const paid = entry?.status === 'paid' ? Number(entry.actual_amount) : 0;
        acc.budget += estimated;
        acc.paid += paid;
        return acc;
      }, {budget:0,paid:0}));
      return {floor,items,totals};
    });
    res.render('expenses/overview', {year,months,floors,csrfToken:req.csrfToken()});
  } catch (error) { next(error); }
});

router.get('/history', async (req, res, next) => {
  try {
    const floor = req.query.floor === undefined ? 4 : Number(req.query.floor);
    if (![4,6].includes(floor)) return res.sendStatus(400);
    const year = getYear(req.query.year);
    const history = (await db.query(`
      SELECT a.id,a.action,a.old_value,a.new_value,a.created_at,
             u.display_name AS changed_by,c.name AS category_name,
             to_char(e.month,'YYYY-MM') AS month_key
      FROM expense_audit a
      JOIN expense_entries e ON e.id=a.entry_id
      JOIN expense_categories c ON c.id=e.category_id
      LEFT JOIN users u ON u.id=a.user_id
      WHERE c.floor=$1 AND e.month>=make_date($2,1,1) AND e.month<make_date($2+1,1,1)
      ORDER BY a.created_at DESC,a.id DESC LIMIT 500`, [floor,year])).rows;
    const payments = (await db.query(`
      SELECT p.id,p.status,p.total_amount,p.payment_date,p.created_at,p.cancelled_at,
             c.name AS category_name,c.floor,
             string_agg(to_char(e.month,'YYYY-MM'), ', ' ORDER BY e.month) AS months
      FROM expense_payments p JOIN expense_categories c ON c.id=p.category_id
      JOIN expense_entries e ON e.payment_id=p.id
      WHERE c.floor=$1 AND e.month>=make_date($2,1,1) AND e.month<make_date($2+1,1,1)
      GROUP BY p.id,c.name,c.floor
      ORDER BY p.created_at DESC LIMIT 200`,[floor,year])).rows;
    res.render('expenses/history',{floor,year,history,payments,csrfToken:req.csrfToken(),error:req.query.error||'',success:req.query.success||''});
  } catch (error) { next(error); }
});

router.post('/payments/:id/cancel', async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) return res.sendStatus(400);
  const client = await db.pool.connect();
  let floor = 4;
  try {
    await client.query('BEGIN');
    const payment = (await client.query(`SELECT p.*,c.floor FROM expense_payments p
      JOIN expense_categories c ON c.id=p.category_id WHERE p.id=$1 FOR UPDATE OF p`,[id])).rows[0];
    if (!payment || payment.cancelled_at) throw new Error('התשלום לא נמצא או כבר בוטל');
    floor = payment.floor;
    const entries = (await client.query('SELECT * FROM expense_entries WHERE payment_id=$1 ORDER BY id FOR UPDATE',[id])).rows;
    if (!entries.length) throw new Error('לא נמצאו רשומות תשלום');
    for (const old of entries) {
      // Preserve the original estimate; release the month for a corrected invoice.
      const updated = (await client.query(`UPDATE expense_entries
        SET actual_amount=NULL,status='estimated',payment_id=NULL,updated_by=$2,updated_at=NOW()
        WHERE id=$1 RETURNING *`,[old.id,req.session.userId])).rows[0];
      await client.query(`INSERT INTO expense_audit(entry_id,user_id,action,old_value,new_value)
        VALUES($1,$2,'cancel_payment',$3,$4)`,[old.id,req.session.userId,JSON.stringify(old),JSON.stringify(updated)]);
    }
    await client.query('UPDATE expense_payments SET cancelled_at=NOW() WHERE id=$1',[id]);
    await client.query('COMMIT');
    res.redirect(`/expenses/extras/history?floor=${floor}&success=${encodeURIComponent('החשבון בוטל. אפשר להזין חשבון מתוקן; ההערכות המקוריות נשמרו.')}`);
  } catch (error) {
    await client.query('ROLLBACK').catch(()=>{});
    res.redirect(`/expenses/extras/history?floor=${floor}&error=${encodeURIComponent(error.message)}`);
  } finally { client.release(); }
});
module.exports = router;
