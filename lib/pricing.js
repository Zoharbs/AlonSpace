function daysBetween(startDate, endDate) {
  const start = new Date(startDate + 'T00:00:00');
  const end = new Date(endDate + 'T00:00:00');

  const diff = end - start;
  return Math.max(1, Math.ceil(diff / (1000 * 60 * 60 * 24)) + 1);
}

function calculateOfficeQuote(office, startDate, endDate) {
  const days = daysBetween(startDate, endDate);

  const dayPrice = Number(office.price_day || 0);
  const weekPrice = Number(office.price_week || 0);
  const monthPrice = Number(office.price_month || 0);
  const yearPrice = Number(office.price_year || 0);

  if (days >= 365 && yearPrice) {
    const years = Math.floor(days / 365);
    const remainingDays = days % 365;
    const remainingMonths = Math.ceil(remainingDays / 30);

    return {
      unit: 'year',
      label: `${years} שנה${remainingMonths ? ` + ${remainingMonths} חודשים` : ''}`,
      days,
      total: years * yearPrice + remainingMonths * monthPrice
    };
  }

  if (days >= 35 && monthPrice) {
    const months = Math.floor(days / 30);
    const remainingDays = days % 30;
    const remainingWeeks = Math.ceil(remainingDays / 7);

    return {
      unit: 'month',
      label: `${months} חודשים${remainingWeeks ? ` + ${remainingWeeks} שבועות` : ''}`,
      days,
      total: months * monthPrice + remainingWeeks * weekPrice
    };
  }

  if (days >= 7 && weekPrice) {
    const weeks = Math.ceil(days / 7);

    return {
      unit: 'week',
      label: `${weeks} שבועות`,
      days,
      total: weeks * weekPrice
    };
  }

  return {
    unit: 'day',
    label: `${days} ימים`,
    days,
    total: days * dayPrice
  };
}

module.exports = { calculateOfficeQuote };