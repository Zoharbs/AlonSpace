from pathlib import Path
import sys
root=Path(sys.argv[1] if len(sys.argv)>1 else '.')
route=root/'routes/expenses.js'
view=root/'views/expenses/index.ejs'
s=route.read_text(encoding='utf-8')
# Fix early returns that leaked checked-out connections.
s=s.replace("if(!Number.isSafeInteger(id)||id<1||!validMoney(amount))return res.sendStatus(400);", "if(!Number.isSafeInteger(id)||id<1||!validMoney(amount))throw Error('נתוני הערכה לא תקינים');")
s=s.replace("if(!Number.isSafeInteger(id)||id<1||!validMoney(amount)||money(amount)<=0||!['paid','estimated'].includes(status))return res.sendStatus(400);", "if(!Number.isSafeInteger(id)||id<1||!validMoney(amount)||money(amount)<=0||!['paid','estimated'].includes(status))throw Error('נתוני חשבון לא תקינים');")
s=s.replace("if(!Number.isSafeInteger(id)||id<1||!validMoney(amount))return res.sendStatus(400);", "if(!Number.isSafeInteger(id)||id<1||!validMoney(amount))throw Error('נתוני תשלום לא תקינים');")
anchor="router.get('/export.xlsx',async(req,res,next)=>{"
assert anchor in s, 'Could not locate export route'
newroute='''// Finalize an existing split electricity/arnona invoice without creating a duplicate.
router.post('/payments/:id/finalize', async (req, res, next) => {
  const paymentId = Number(req.params.id);
  const paymentDate = String(req.body.payment_date || '').trim();
  if (!Number.isSafeInteger(paymentId) || paymentId < 1 ||
      !/^\\d{4}-\\d{2}-\\d{2}$/.test(paymentDate) ||
      Number.isNaN(Date.parse(paymentDate)) ||
      new Date(paymentDate).toISOString().slice(0, 10) !== paymentDate) {
    return res.status(400).send('מספר חשבון או תאריך תשלום לא תקין');
  }
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const paymentResult = await client.query(
      'SELECT * FROM expense_payments WHERE id=$1 FOR UPDATE', [paymentId]
    );
    const payment = paymentResult.rows[0];
    if (!payment || payment.status !== 'estimated' || payment.cancelled_at) {
      throw Error('החשבון לא נמצא או שכבר שולם');
    }
    const entriesResult = await client.query(
      'SELECT * FROM expense_entries WHERE payment_id=$1 ORDER BY month FOR UPDATE',
      [paymentId]
    );
    const entries = entriesResult.rows;
    if (!entries.length || entries.some(e => e.status !== 'estimated')) {
      throw Error('מצב שורות החשבון אינו תקין');
    }
    const portions = splitAgorot(payment.total_amount, entries.map(e =>
      e.month instanceof Date ? e.month.toISOString().slice(0, 7) : String(e.month).slice(0, 7)
    ));
    for (let i = 0; i < entries.length; i++) {
      const old = entries[i];
      const result = await client.query(
        `UPDATE expense_entries SET actual_amount=$2, status='paid',
          updated_by=$3, updated_at=NOW() WHERE id=$1 RETURNING *`,
        [old.id, portions[i].amount, req.expenseUser.id]
      );
      await audit(client, result.rows[0], req.expenseUser.id, 'finalize_payment', old);
    }
    await client.query(
      `UPDATE expense_payments SET status='paid', payment_date=$2 WHERE id=$1`,
      [paymentId, paymentDate]
    );
    await client.query('COMMIT');
    res.redirect(redirect('success', 'החשבון סומן כשולם'));
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    res.redirect(redirect('error', error.message));
  } finally {
    client.release();
  }
});
'''
if "router.post('/payments/:id/finalize'" not in s:
    s=s.replace(anchor,newroute+'\n'+anchor)
route.write_text(s,encoding='utf-8')
v=view.read_text(encoding='utf-8')
needle='<label class="regular">חודש'
assert needle in v, 'Could not locate invoice form'
if 'name="payment_date"' not in v:
    v=v.replace(needle, '<label>תאריך תשלום<input type="date" name="payment_date"></label>'+needle)
# Add a finalize form only to an existing split invoice; repeat per cell is fine but only once per invoice via first month.
needle='<% if(!paid && !e?.payment_id){ %>'
assert needle in v, 'Could not locate table cell controls'
replacement='''<% if(!paid && e?.payment_id && !months.slice(0, months.indexOf(m)).some(previous => entryMap[c.id+':'+previous]?.payment_id === e.payment_id)){ %><form method="post" action="/expenses/payments/<%= e.payment_id %>/finalize"><input type="hidden" name="_csrf" value="<%= csrfToken %>"><input type="date" name="payment_date" required aria-label="תאריך תשלום"><button type="submit">סמן חשבון כשולם</button></form><% } %>'''+needle
if 'סמן חשבון כשולם' not in v:
    v=v.replace(needle,replacement)
view.write_text(v,encoding='utf-8')
print('Patched',route,'and',view)
