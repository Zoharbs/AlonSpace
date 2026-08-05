const db = require('../db');

const WORK_HOURS = ['09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00'];

function isWeekend(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const day = d.getDay();
  return day === 5 || day === 6;
}

function isWithinNextWeek(dateStr) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const maxDate = new Date(today);
  maxDate.setDate(maxDate.getDate() + 7);

  const target = new Date(dateStr + 'T00:00:00');
  return target >= today && target <= maxDate;
}

function toDateTime(dateStr, timeStr) {
  return new Date(`${dateStr}T${timeStr}:00`);
}

function isBlockedByRange(dateStr, timeStr) {
  const slotStart = toDateTime(dateStr, timeStr);
  const slotEnd = new Date(slotStart);
  slotEnd.setHours(slotEnd.getHours() + 1);

  const blocks = db
    .prepare(`
      SELECT * FROM availability_blocks
      WHERE block_type = 'tour'
        AND start_at < ?
        AND end_at > ?
    `)
    .all(slotEnd.toISOString().slice(0, 16), slotStart.toISOString().slice(0, 16));

  return blocks.length > 0;
}

function getAvailableSlots(dateStr) {
  if (!dateStr || isWeekend(dateStr)) return [];
  if (!isWithinNextWeek(dateStr)) return [];

  const taken = db
    .prepare(`SELECT time_slot FROM bookings WHERE booking_date = ? AND status != 'בוטל'`)
    .all(dateStr)
    .map((r) => r.time_slot);

  const blockedOld = db
    .prepare(`SELECT time_slot FROM blocked_slots WHERE blocked_date = ?`)
    .all(dateStr)
    .map((r) => r.time_slot);

  const minStart = new Date();
  minStart.setHours(minStart.getHours() + 3);

  return WORK_HOURS.filter((hour) => {
    if (taken.includes(hour)) return false;
    if (blockedOld.includes(hour)) return false;
    if (isBlockedByRange(dateStr, hour)) return false;

    const slotStart = toDateTime(dateStr, hour);
    if (slotStart < minStart) return false;

    return true;
  });
}

module.exports = { getAvailableSlots, isWeekend, WORK_HOURS };