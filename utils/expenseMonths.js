'use strict';
function isoMonth(value) {
  if (!/^\d{4}-\d{2}$/.test(value)) throw Error('חודש לא תקין');
  const [year, month] = value.split('-').map(Number);
  if (year < 2020 || year > 2100 || month < 1 || month > 12) throw Error('חודש לא תקין');
  return `${value}-01`;
}
function parseDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) throw Error('תאריך צריכה לא תקין');
  const ms = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== value) throw Error('תאריך צריכה לא תקין');
  return ms;
}
function electricityMonths(start, end) {
  const from = parseDate(start), to = parseDate(end);
  if (from > to) throw Error('תאריך הסיום קודם לתאריך ההתחלה');
  if ((to - from) / 86400000 > 366) throw Error('תקופת צריכה ארוכה משנה; יש לפצל חשבונות');
  const months = [];
  for (let d = from; d <= to; d += 86400000) {
    const month = new Date(d).toISOString().slice(0, 7);
    if (months[months.length - 1] !== month) months.push(month);
  }
  return months;
}
function toCents(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0 || Math.abs(n * 100 - Math.round(n * 100)) > 1e-7) throw Error('סכום לא תקין');
  return Math.round(n * 100);
}
function allocate(amount, weightedMonths) {
  const cents = toCents(amount);
  if (!weightedMonths.length) throw Error('יש לבחור חודשים');
  const totalWeight = weightedMonths.reduce((sum, item) => sum + item.weight, 0);
  if (!totalWeight) throw Error('תקופת צריכה לא תקינה');
  let used = 0;
  return weightedMonths.map(({ month, weight }, i) => {
    const share = i === weightedMonths.length - 1 ? cents - used : Math.floor(cents * weight / totalWeight);
    used += share;
    return { month: isoMonth(month), amount: (share / 100).toFixed(2) };
  });
}
function splitAgorot(amount, months) {
  return allocate(amount, months.map(month => ({ month, weight: 1 })));
}
function electricityPortions(amount, start, end) {
  const months = electricityMonths(start, end);
  const counts = new Map(months.map(month => [month, 0]));
  for (let d = parseDate(start), last = parseDate(end); d <= last; d += 86400000) {
    const month = new Date(d).toISOString().slice(0, 7);
    counts.set(month, counts.get(month) + 1);
  }
  return allocate(amount, [...counts].map(([month, weight]) => ({ month, weight })));
}
module.exports = { isoMonth, electricityMonths, electricityPortions, splitAgorot };
