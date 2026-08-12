const nodemailer = require('nodemailer');

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
    return null;
  }
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
  return transporter;
}

async function sendMail({ subject, text, html, replyTo }) {
  const t = getTransporter();
  const to = process.env.CONTACT_EMAIL || 'zoharbs235@gmail.com';
  if (!t) {
    console.log('[mail] SMTP לא מוגדר - מדלג על שליחת מייל. נושא:', subject);
    return { skipped: true };
  }
  try {
    await t.sendMail({
      from: `"אתר AlonSpace" <${process.env.SMTP_USER}>`,
      to,
      replyTo,
      subject,
      text,
      html,
    });
    return { sent: true };
  } catch (err) {
    console.error('[mail] שגיאה בשליחת מייל:', err.message);
    return { error: err.message };
  }
}

module.exports = { sendMail };
