'use strict';
const express = require('express');
const db = require('../db');
const router = express.Router();
router.use(async (req, res, next) => {
  try {
    if (!req.session?.userId) return res.redirect('/login');
    const result = await db.query('SELECT id FROM users WHERE id=$1 AND is_active=TRUE AND role=$2', [req.session.userId, 'admin']);
    if (!result.rowCount) return res.sendStatus(403);
    res.set('Cache-Control', 'no-store');
    next();
  } catch (error) { next(error); }
});
router.get('/', async (req, res, next) => {
  try {
    const users = (await db.query('SELECT id,username,display_name,role,can_manage_expenses FROM users WHERE is_active=TRUE ORDER BY display_name,id')).rows;
    res.render('expenses/access', { users, csrfToken: req.csrfToken(), error: req.query.error || '', success: req.query.success || '' });
  } catch (error) { next(error); }
});
router.post('/', async (req, res, next) => {
  const client = await db.pool.connect();
  try {
    const ids = [...new Set((Array.isArray(req.body.user_ids) ? req.body.user_ids : req.body.user_ids ? [req.body.user_ids] : []).map(Number))];
    if (ids.length > 2 || ids.some(id => !Number.isSafeInteger(id) || id < 1)) return res.status(400).send('ניתן לבחור עד שני משתמשים');
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(726315)');
    const valid = (await client.query('SELECT id FROM users WHERE id=ANY($1::bigint[]) AND is_active=TRUE', [ids])).rows;
    if (valid.length !== ids.length) throw new Error('משתמש לא פעיל או לא קיים');
    await client.query('UPDATE users SET can_manage_expenses=(id=ANY($1::bigint[])), updated_at=NOW() WHERE can_manage_expenses=TRUE OR id=ANY($1::bigint[])', [ids]);
    await client.query('COMMIT');
    res.redirect('/admin/expense-access?success=' + encodeURIComponent('ההרשאות נשמרו'));
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    res.redirect('/admin/expense-access?error=' + encodeURIComponent(error.message));
  } finally { client.release(); }
});
module.exports = router;
