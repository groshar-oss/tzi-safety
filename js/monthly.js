// דוח חודשי ליזם: מספרים של חודש אחד באתר, ומגמה של כמה חודשים. בלי תלות בדפדפן או בשרת,
// כדי שאותו חישוב ישמש גם את המסך וגם את המייל החודשי (עותק בפונקציית המיילים, sync-mail.sh)
const TZ = 'Asia/Jerusalem';
const DAY = 864e5;
const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ });
export const israelDayOf = t => t ? (String(t).length === 10 ? String(t) : dayFmt.format(new Date(t))) : '';
export const monthOf = t => israelDayOf(t).slice(0, 7);
const lastDay = ym => { const [y, m] = ym.split('-').map(Number); return `${ym}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`; };
export const MONTHS_HE = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
export const monthName = ym => { const [y, m] = ym.split('-').map(Number); return `${MONTHS_HE[m - 1]} ${y}`; };
// חודשים אחורה מ-ym (כולל), מהישן לחדש
export function monthsBack(ym, n) {
  const [y, m] = ym.split('-').map(Number), out = [];
  for (let i = n - 1; i >= 0; i--) { const d = new Date(Date.UTC(y, m - 1 - i, 1)); out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`); }
  return out;
}
export const prevMonth = (now = Date.now()) => monthsBack(monthOf(now), 2)[0];

// counts: מספרים מצטברים מהשרת למי שלא רואה את פנקס העובדים (יזם): worker_days, work_days, trainings, training_sigs, new_workers
export function siteMonth(data, siteId, ym, counts = null) {
  const end = lastDay(ym), inM = t => monthOf(t) === ym;
  const of = k => (data[k] || []).filter(r => r.site_id === siteId);
  const defects = of('defects');
  const created = defects.filter(d => inM(d.created_at)), closed = defects.filter(d => inM(d.closed_at));
  const openEnd = defects.filter(d => israelDayOf(d.created_at) <= end && (!d.closed_at || israelDayOf(d.closed_at) > end));
  const fix = closed.map(d => (new Date(d.closed_at) - new Date(d.created_at)) / DAY);
  const byResp = {};
  for (const d of created) { const k = (d.responsible || '—').trim(); const r = byResp[k] ||= { name: k, created: 0, closed: 0, late: 0 }; r.created++; if (d.closed_at) r.closed++; if (d.due_date && (d.closed_at ? israelDayOf(d.closed_at) > d.due_date : d.due_date < end)) r.late++; }
  const att = of('attendance').filter(a => a.present !== false && String(a.day).slice(0, 7) === ym);
  const workDays = counts ? counts.work_days : new Set(att.map(a => a.day)).size;
  const workerDays = counts ? counts.worker_days : att.length;
  const bakar = of('bakar_reports').filter(r => inM(r.visit_at));
  const checks = of('equipment_checks').filter(c => String(c.day).slice(0, 7) === ym);
  return {
    ym,
    defNew: created.length, defClosed: closed.length, defOpenEnd: openEnd.length,
    defLateEnd: openEnd.filter(d => d.due_date && d.due_date < end).length,
    defCrit: created.filter(d => d.severity === 'crit').length,
    fixDays: fix.length ? Math.round(10 * fix.reduce((a, b) => a + b, 0) / fix.length) / 10 : null,
    byResp: Object.values(byResp).sort((a, b) => b.created - a.created),
    accidents: of('accident_reports').filter(r => inM(r.occurred_at)).length,
    events: of('events').filter(e => inM(e.occurred_at)).length,
    bakar: bakar.length, bakarFindings: bakar.reduce((n, r) => n + (r.findings || []).length, 0),
    workDays, workerDays, avgWorkers: workDays ? Math.round(workerDays / workDays) : 0,
    trainings: counts ? counts.trainings : of('trainings').filter(t => inM(t.held_at)).length,
    trainingSigs: counts ? counts.training_sigs : of('training_signatures').filter(g => inM(g.signed_at)).length,
    newWorkers: counts ? counts.new_workers : of('workers').filter(w => inM(w.created_at)).length,
    eqChecks: checks.length, eqFail: checks.filter(c => !c.ok).length,
    checkinDays: new Set(of('checkins').filter(c => inM(c.at)).map(c => israelDayOf(c.at))).size,
    dutiesDone: of('duties').filter(d => d.status === 'done' && d.key !== 'daily_checkin' && inM(d.done_at)).length,
    inspections: of('site_inspections').filter(x => inM(x.started_at)).length
  };
}

// שורות הטבלה: [כותרת, מפתח, האם עלייה היא טובה]
export const TREND_ROWS = [
  ['ליקויים חדשים', 'defNew', false], ['ליקויים שתוקנו', 'defClosed', true], ['ליקויים פתוחים בסוף החודש', 'defOpenEnd', false], ['מהם באיחור', 'defLateEnd', false],
  ['ימים בממוצע לתיקון ליקוי', 'fixDays', false], ['תאונות שתועדו', 'accidents', false], ['אירועים שדווחו', 'events', false], ['ביקורי בקר בטיחות', 'bakar', true],
  ['ימי עבודה', 'workDays', null], ['ימי עובד (נוכחות)', 'workerDays', null], ['ממוצע עובדים ביום', 'avgWorkers', null], ['הדרכות', 'trainings', true], ['חתימות עובדים על הדרכות', 'trainingSigs', true],
  ['בדיקות יומיות לציוד', 'eqChecks', true], ['מהן נכשלו', 'eqFail', false], ["ימים עם צ'ק-אין של מנהל העבודה", 'checkinDays', true], ['חובות שבוצעו', 'dutiesDone', true]
];
// חץ מגמה מול החודש הקודם
export function arrow(cur, prev, upGood) {
  if (cur == null || prev == null || cur === prev || upGood === null) return '';
  const up = cur > prev;
  return up === upGood ? (up ? '▲' : '▼') + ' שיפור' : (up ? '▲' : '▼') + ' הרעה';
}
