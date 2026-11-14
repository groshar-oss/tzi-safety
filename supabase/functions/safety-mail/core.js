// בניית המיילים של מערכת הבטיחות: התראה מיידית על חריגה קריטית, סיכום בוקר לכל אחראי, דוח שבועי ליזם.
// קובץ בלי תלות בשרת, כדי שאפשר לבדוק אותו גם מחוץ ל-Supabase. duties.js הוא עותק של js/duties.js (sync-mail.sh)
import { level, recipients, leftText, LEVELS, ROLES, EVENTS } from './duties.js';
import { siteMonth, monthsBack, monthName, TREND_ROWS, arrow } from './monthly.js';

export const APP = 'https://safety.tzi-eng.co.il/';
const TZ = 'Asia/Jerusalem';
const DAY = 864e5;

// שעה, יום בשבוע ותאריך בשעון ישראל
export function israelNow(now = Date.now()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false })
    .formatToParts(new Date(now)).map(x => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, hour: +p.hour % 24, minute: +p.minute, dow: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday) };
}
const fmt = t => t ? new Date(t).toLocaleString('he-IL', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
const fmtD = t => t ? new Date(String(t).length === 10 ? t + 'T12:00:00Z' : t).toLocaleDateString('he-IL', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' }) : '';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const mailOf = p => String(p?.email || '').trim().toLowerCase();
const dutyUrl = d => `${APP}#/site/${d.site_id}/duties/${d.id}`;
const COLOR = { crit: '#7a0f0f', red: '#c62828', warn: '#e08a00', info: '#3D5A78' };

// מעטפת המייל: מימין לשמאל, מותג צי הנדסה
function wrap(title, inner, foot = '') {
  return `<!doctype html><html dir="rtl" lang="he"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;background:#f3f4f7;font-family:Arial,Helvetica,sans-serif;color:#1d2433;direction:rtl">
<div style="max-width:620px;margin:0 auto;padding:16px">
<div style="background:#1d2433;color:#fff;padding:14px 18px;border-radius:10px 10px 0 0;font-size:15px"><b>צי הנדסה</b> · מערכת ניהול הבטיחות</div>
<div style="background:#fff;padding:18px;border-radius:0 0 10px 10px;text-align:right">
<h2 style="margin:0 0 12px;font-size:19px">${esc(title)}</h2>
${inner}
<p style="margin:22px 0 0"><a href="${APP}" style="background:#3D5A78;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;display:inline-block">כניסה למערכת</a></p>
</div>
<p style="font-size:12px;color:#7a8297;text-align:center;margin:12px 0">${foot || 'הודעה אוטומטית ממערכת ניהול הבטיחות של צי הנדסה. נשלחת למי שרשום באתר בתפקיד שהחובה מוטלת עליו.'}</p>
</div></body></html>`;
}
const dutyRow = x => `<div style="border-right:4px solid ${COLOR[x.level] || '#999'};background:#fafbfc;padding:10px 12px;margin:8px 0;border-radius:6px">
  <div style="font-size:12px;color:${COLOR[x.level] || '#666'};font-weight:bold">${esc(LEVELS[x.level]?.label || '')}</div>
  <div style="font-weight:bold;margin:2px 0"><a href="${dutyUrl(x.duty)}" style="color:#1d2433">${esc(x.duty.title)}</a></div>
  <div style="font-size:13px;color:#555">${x.duty.due_at ? `מועד: ${fmt(x.duty.due_at)} · ${esc(leftText(x.duty, x.now))}` : 'פתוח עד ביצוע'} · אחראי: ${esc(x.roles.map(r => ROLES[r]).join(', '))}</div>
  ${x.note ? `<div style="font-size:12px;color:#7a5a00;margin-top:3px">${esc(x.note)}</div>` : ''}</div>`;
const dutyText = x => `• ${LEVELS[x.level]?.label}: ${x.duty.title}${x.duty.due_at ? ` (${leftText(x.duty, x.now)})` : ''}\n  ${dutyUrl(x.duty)}`;

// חריגות פתוחות לפי אתר, עם הנמענים של כל אחת
function openItems(data, now) {
  const out = [];
  for (const s of data.sites) {
    if (['done', 'closed_order'].includes(s.status) || s.demo) continue;
    const people = data.site_people.filter(p => p.site_id === s.id);
    for (const d of data.duties) {
      if (d.site_id !== s.id || d.status !== 'open') continue;
      const r = recipients(d, s, people, now);
      if (!['crit', 'red', 'warn'].includes(r.level)) continue;
      out.push({ duty: d, site: s, now, ...r });
    }
  }
  const rank = x => LEVELS[x.level].rank;
  return out.sort((a, b) => rank(b) - rank(a) || String(a.duty.due_at || '9').localeCompare(String(b.duty.due_at || '9')));
}
const addrs = list => [...new Set(list.map(mailOf).filter(e => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)))];

// ===== 1. התראה מיידית: חובה קריטית שעוד לא נשלחה עליה התראה =====
export function alertMails(data, now = Date.now()) {
  const out = [];
  for (const x of openItems(data, now).filter(x => x.level === 'crit')) {
    const to = addrs(x.to), cc = addrs(x.cc).filter(e => !to.includes(e));
    if (!to.length && !cc.length) continue;
    const ev = x.duty.event_id ? data.events.find(e => e.id === x.duty.event_id) : null;
    const subject = `⛔ קריטי | ${x.site.name} | ${x.duty.title}`.slice(0, 180);
    const inner = `<p style="margin:0 0 6px">באתר <b>${esc(x.site.name)}</b> נפתחה חובה קריטית שצריך לטפל בה עכשיו.</p>
      ${ev ? `<p style="margin:0 0 6px;font-size:14px;color:#555">האירוע: ${esc(EVENTS[ev.type]?.label || ev.type)}${ev.description ? ' · ' + esc(ev.description) : ''} · ${fmt(ev.occurred_at)}</p>` : ''}
      ${dutyRow(x)}${x.duty.ref ? `<p style="font-size:12px;color:#7a8297">§ ${esc(x.duty.ref)}</p>` : ''}`;
    out.push({ kind: 'alert', key: `alert:${x.duty.id}`, site_id: x.site.id, event: !!ev, to: to.length ? to : cc, cc: to.length ? cc : [], subject,
      html: wrap('חובה קריטית באתר', inner), text: `באתר ${x.site.name} נפתחה חובה קריטית:\n${dutyText(x)}` });
  }
  return out;
}

// ===== 2. סיכום בוקר: לכל אדם, מה פתוח אצלו ומה הוא מקבל לידיעה =====
export function digestMails(data, now = Date.now()) {
  const day = israelNow(now).day;
  const items = openItems(data, now);
  const by = new Map();
  const add = (p, x, mine) => { const e = mailOf(p); if (!e) return; if (!by.has(e)) by.set(e, { name: p.name, mine: [], cc: [] }); const b = by.get(e);
    if (![...b.mine, ...b.cc].some(y => y.duty.id === x.duty.id)) b[mine ? 'mine' : 'cc'].push(x); };
  for (const x of items) { x.to.forEach(p => add(p, x, true)); x.cc.forEach(p => add(p, x, false)); }
  const out = [];
  for (const [email, b] of by) {
    const n = b.mine.length + b.cc.length; if (!n) continue;
    const crit = [...b.mine, ...b.cc].filter(x => x.level === 'crit').length, red = [...b.mine, ...b.cc].filter(x => x.level === 'red').length;
    const group = list => { const g = new Map(); for (const x of list) { if (!g.has(x.site.id)) g.set(x.site.id, { site: x.site, xs: [] }); g.get(x.site.id).xs.push(x); } return [...g.values()]; };
    const sec = (title, list) => list.length ? `<h3 style="font-size:16px;margin:18px 0 4px">${title}</h3>` + group(list).map(g => `<div style="font-size:14px;font-weight:bold;margin:10px 0 0;color:#3D5A78">${esc(g.site.name)}</div>${g.xs.map(dutyRow).join('')}`).join('') : '';
    const first = String(b.name || '').replace(/ \(.*\)$/, '').split(' ')[0];
    const inner = `<p style="margin:0">בוקר טוב${first ? ' ' + esc(first) : ''}. ${crit ? `<b style="color:#7a0f0f">${crit} קריטי</b>, ` : ''}${red ? `<b style="color:#c62828">${red} באיחור</b>, ` : ''}${n} פריטים פתוחים בסך הכול.</p>
      ${sec('באחריותך', b.mine)}${sec('לידיעתך (הסלמה או עותק לפי התקנות)', b.cc)}`;
    out.push({ kind: 'digest', key: `digest:${email}:${day}`, to: [email], cc: [], subject: `סיכום בוקר: ${crit ? crit + ' קריטי, ' : ''}${red ? red + ' באיחור, ' : ''}${n} פתוחים`,
      html: wrap('סיכום בוקר', inner), text: [...b.mine, ...b.cc].map(dutyText).join('\n') });
  }
  return out;
}

// ===== 3. דוח שבועי ליזם: מצב כל אתר בשבוע שעבר =====
export function compliance(duties, now) {
  const latest = new Map();
  for (const d of duties.filter(d => d.status !== 'na')) {
    const k = d.event_id ? d.id : d.key, cur = latest.get(k);
    if (!cur || (cur.status !== 'open' && (d.status === 'open' || String(d.created_at) > String(cur.created_at)))) latest.set(k, d);
  }
  const arr = [...latest.values()], bad = arr.filter(d => ['red', 'crit'].includes(level(d, now)));
  return { total: arr.length, bad: bad.length, pct: arr.length ? Math.round(100 * (arr.length - bad.length) / arr.length) : 100 };
}
export function siteWeek(data, s, now = Date.now()) {
  const from = now - 7 * DAY, inWeek = t => t && new Date(t).getTime() >= from && new Date(t).getTime() <= now;
  const today = israelNow(now).day;
  const duties = data.duties.filter(d => d.site_id === s.id);
  const people = data.site_people.filter(p => p.site_id === s.id);
  const open = duties.filter(d => d.status === 'open').map(d => ({ duty: d, now, ...recipients(d, s, people, now) })).filter(x => ['crit', 'red'].includes(x.level));
  const defects = (data.defects || []).filter(d => d.site_id === s.id);
  const att = (data.attendance || []).filter(a => a.site_id === s.id && a.present !== false && new Date(a.day + 'T12:00:00Z').getTime() >= from - DAY);
  const days = new Set(att.map(a => a.day));
  const checkDays = new Set((data.checkins || []).filter(c => c.site_id === s.id && inWeek(c.at)).map(c => israelNow(new Date(c.at).getTime()).day));
  return {
    site: s, comp: compliance(duties, now), open,
    done: duties.filter(d => d.status === 'done' && inWeek(d.done_at)).length,
    events: (data.events || []).filter(e => e.site_id === s.id && inWeek(e.occurred_at)),
    defOpen: defects.filter(d => !d.closed_at).length, defLate: defects.filter(d => !d.closed_at && d.due_date && d.due_date < today).length,
    defNew: defects.filter(d => inWeek(d.created_at)).length, defClosed: defects.filter(d => inWeek(d.closed_at)).length,
    bakar: (data.bakar_reports || []).filter(r => r.site_id === s.id && inWeek(r.visit_at)),
    accidents: (data.accident_reports || []).filter(r => r.site_id === s.id && inWeek(r.occurred_at)).length,
    workDays: days.size, avgWorkers: days.size ? Math.round(att.length / days.size) : 0, checkDays: checkDays.size
  };
}
export function weeklyMails(data, now = Date.now()) {
  const { day } = israelNow(now);
  const sites = data.sites.filter(s => !s.demo && !['done', 'closed_order', 'planning'].includes(s.status));
  const by = new Map();
  for (const s of sites) for (const p of data.site_people.filter(p => p.site_id === s.id && p.role === 'dev' && p.active !== false)) {
    const e = mailOf(p); if (!e) continue; if (!by.has(e)) by.set(e, { name: p.name, sites: [] }); if (!by.get(e).sites.includes(s)) by.get(e).sites.push(s);
  }
  const out = [];
  for (const [email, b] of by) {
    const ws = b.sites.map(s => siteWeek(data, s, now)).sort((a, b2) => a.comp.pct - b2.comp.pct);
    const card = w => `<div style="border:1px solid #e3e6ee;border-radius:8px;padding:12px;margin:12px 0">
      <div style="font-size:16px;font-weight:bold">${esc(w.site.name)}</div>
      <table style="width:100%;border-collapse:collapse;margin:8px 0;font-size:14px" dir="rtl"><tr>
        <td style="padding:4px"><div style="color:#7a8297;font-size:12px">עמידה בחובות</div><b style="font-size:20px;color:${w.comp.pct >= 95 ? '#13804a' : w.comp.pct >= 80 ? '#e08a00' : '#c62828'}">${w.comp.pct}%</b></td>
        <td style="padding:4px"><div style="color:#7a8297;font-size:12px">חובות שבוצעו השבוע</div><b style="font-size:20px">${w.done}</b></td>
        <td style="padding:4px"><div style="color:#7a8297;font-size:12px">ליקויים פתוחים</div><b style="font-size:20px;color:${w.defLate ? '#c62828' : '#1d2433'}">${w.defOpen}</b>${w.defLate ? `<div style="font-size:12px;color:#c62828">${w.defLate} באיחור</div>` : ''}</td>
        <td style="padding:4px"><div style="color:#7a8297;font-size:12px">ימי עבודה / ממוצע עובדים</div><b style="font-size:20px">${w.workDays} / ${w.avgWorkers}</b></td></tr></table>
      <div style="font-size:13px;color:#444;line-height:1.7">
        צ׳ק-אין של מנהל העבודה: ${w.checkDays} ימים השבוע.<br>
        ליקויים: ${w.defNew} חדשים, ${w.defClosed} תוקנו.<br>
        ביקורי בקר: ${w.bakar.length ? w.bakar.map(r => fmtD(r.visit_at) + ` (${(r.findings || []).length} ממצאים${(r.findings || []).some(f => f.unacceptable) ? ', יש סיכון שאינו קביל' : ''})`).join(', ') : 'לא היו השבוע'}.<br>
        ${w.events.length ? 'אירועים: ' + w.events.map(e => esc(EVENTS[e.type]?.label || e.type) + ' ' + fmtD(e.occurred_at)).join(' · ') + '.<br>' : ''}
        ${w.accidents ? `<b style="color:#7a0f0f">תאונות השבוע: ${w.accidents}</b><br>` : ''}
      </div>
      ${w.open.length ? `<div style="font-size:14px;font-weight:bold;margin-top:8px">חריגות פתוחות (${w.open.length})</div>${w.open.slice(0, 8).map(dutyRow).join('')}${w.open.length > 8 ? `<div style="font-size:13px;color:#555">ועוד ${w.open.length - 8} במערכת</div>` : ''}` : '<div style="color:#13804a;font-size:14px;margin-top:6px">אין חריגות פתוחות 👍</div>'}
    </div>`;
    const first = String(b.name || '').replace(/ \(.*\)$/, '').split(' ')[0];
    const inner = `<p style="margin:0">שלום${first ? ' ' + esc(first) : ''}, זה מצב הבטיחות באתרים שלך בשבוע האחרון (עד ${fmtD(now)}).</p>${ws.map(card).join('')}`;
    out.push({ kind: 'weekly', key: `weekly:${email}:${day}`, to: [email], cc: [], subject: `דוח בטיחות שבועי: ${ws.length === 1 ? ws[0].site.name : ws.length + ' אתרים'}`,
      html: wrap('דוח בטיחות שבועי ליזם', inner, 'דוח שבועי אוטומטי ממערכת ניהול הבטיחות של צי הנדסה. נשלח לנציג היזם הרשום באתר בכל יום ראשון בבוקר.'),
      text: ws.map(w => `${w.site.name}: עמידה ${w.comp.pct}%, ${w.open.length} חריגות פתוחות, ${w.defOpen} ליקויים פתוחים`).join('\n') });
  }
  return out;
}

// ===== 4. דוח חודשי ליזם: ב-1 לכל חודש, החודש שעבר מול החודש שלפניו =====
export function monthlyMails(data, now = Date.now()) {
  const { day } = israelNow(now);
  const [prev2, prev] = monthsBack(day.slice(0, 7), 3).slice(0, 2);
  const sites = data.sites.filter(s => !s.demo && !['planning'].includes(s.status));
  const by = new Map();
  for (const s of sites) for (const p of data.site_people.filter(p => p.site_id === s.id && p.role === 'dev' && p.active !== false)) {
    const e = mailOf(p); if (!e) continue; if (!by.has(e)) by.set(e, { name: p.name, sites: [] }); if (!by.get(e).sites.includes(s)) by.get(e).sites.push(s);
  }
  const out = [];
  for (const [email, b] of by) {
    const cards = b.sites.map(s => {
      const c = siteMonth(data, s.id, prev), p = siteMonth(data, s.id, prev2);
      if (!c.workDays && !c.defNew && !c.dutiesDone && !c.accidents && !c.bakar) return '';
      return `<div style="border:1px solid #e3e6ee;border-radius:8px;padding:12px;margin:12px 0">
        <div style="font-size:16px;font-weight:bold">${esc(s.name)}</div>
        <table style="width:100%;border-collapse:collapse;margin:8px 0;font-size:13px" dir="rtl">
          <tr style="color:#7a8297"><td></td><td style="padding:3px 6px">${esc(monthName(prev2))}</td><td style="padding:3px 6px"><b>${esc(monthName(prev))}</b></td><td></td></tr>
          ${TREND_ROWS.map(([l, k, g]) => { const a = arrow(c[k], p[k], g); return `<tr style="border-top:1px solid #f0f1f5"><td style="padding:3px 6px">${esc(l)}</td><td style="padding:3px 6px;color:#7a8297">${p[k] ?? '—'}</td><td style="padding:3px 6px"><b>${c[k] ?? '—'}</b></td><td style="padding:3px 6px;color:${/שיפור/.test(a) ? '#13804a' : '#c62828'}">${a}</td></tr>`; }).join('')}
        </table>
        ${c.byResp.length ? `<div style="font-size:13px;color:#444">ליקויים לפי אחראי: ${c.byResp.slice(0, 6).map(r => `${esc(r.name)}: ${r.created} נפתחו, ${r.closed} תוקנו${r.late ? `, <b style="color:#c62828">${r.late} באיחור</b>` : ''}`).join(' · ')}</div>` : ''}
      </div>`;
    }).filter(Boolean);
    if (!cards.length) continue;
    const first = String(b.name || '').replace(/ \(.*\)$/, '').split(' ')[0];
    const inner = `<p style="margin:0">שלום${first ? ' ' + esc(first) : ''}, זה סיכום הבטיחות של ${esc(monthName(prev))} באתרים שלך, מול החודש שלפניו. הדוח המלא עם מגמה של חצי שנה נמצא במערכת, בכפתור "דוח חודשי" במסך האתר.</p>${cards.join('')}`;
    out.push({ kind: 'monthly', key: `monthly:${email}:${prev}`, to: [email], cc: [], subject: `דוח בטיחות חודשי: ${monthName(prev)}`,
      html: wrap('דוח בטיחות חודשי ליזם', inner, 'דוח חודשי אוטומטי ממערכת ניהול הבטיחות של צי הנדסה. נשלח לנציג היזם הרשום באתר ב-1 לכל חודש.'),
      text: `סיכום הבטיחות של ${monthName(prev)}: ${b.sites.map(s => s.name).join(', ')}. ${APP}` });
  }
  return out;
}

// מה לשלוח עכשיו. מפעילים כל 15 דקות: התראות (אירוע בכל שעה, השאר ביום), סיכום בוקר מ-07:00 בימים א'-ו', דוח שבועי ביום ראשון מ-07:00
export function plan(data, now = Date.now(), opts = {}) {
  const t = israelNow(now);
  const morning = t.hour >= 7 && t.hour < 11;
  // אירוע (תאונה, הפסקת עבודה) נשלח מיד בכל שעה. חובה קריטית אחרת נשלחת בין 07:00 ל-20:00
  const day = t.hour >= 7 && t.hour < 20;
  const out = alertMails(data, now).filter(m => day || m.event);
  if ((morning && t.dow !== 6) || opts.forceDigest) out.push(...digestMails(data, now));
  if ((morning && t.dow === 0) || opts.forceWeekly) out.push(...weeklyMails(data, now));
  if ((morning && t.day.endsWith('-01')) || opts.forceMonthly) out.push(...monthlyMails(data, now));
  return out;
}
