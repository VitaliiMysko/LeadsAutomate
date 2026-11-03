// The daily limit of found (saved) leads: the count of the current day,
// kept as { date, saved }, and whether it reached the user's limit
// ({ enabled, value }).

// The local calendar day of `date`, "YYYY-MM-DD".
export function localDateKey(date = new Date()) {
  const pad = (number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// Leads found on `today`; a count kept for another day is 0.
export function foundToday(daily, today) {
  if (daily?.date !== today) return 0;
  const saved = Number(daily.saved);
  return Number.isFinite(saved) && saved > 0 ? Math.floor(saved) : 0;
}

// The count with `added` more leads found on `today`, started over on a
// new day.
export function addFound(daily, today, added = 1) {
  return { date: today, saved: foundToday(daily, today) + added };
}

// Whether the leads found today reached the limit, when it's on.
export function dailyLimitReached(daily, limit, today) {
  return !!limit?.enabled && foundToday(daily, today) >= limit.value;
}
