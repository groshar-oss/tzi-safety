// דוח חודשי ליזם: מגמות בטיחות באתר, חודש מול חודש, עם PDF
import { db, isCloud } from '../db.js';
import { S, hasRole, siteOrgs, conNames } from '../app.js';
import { esc, h, $, toast } from '../util.js';
import { canSeeWorkers } from './workers.js';
import { compliance, fmtDT } from './common.js';
import { exceptions } from '../alerts.js';
import { renderPdfPages, pagesToPdf } from '../workers.js';
import { siteMonth, monthsBack, prevMonth, monthName, TREND_ROWS, arrow, monthOf } from '../monthly.js';

export const canMonthly = siteId => hasRole(siteId, 'dev', 'bakar', 'con', 'so', 'sm');
const N = 6;

// מי שלא רואה את פנקס העובדים (היזם) מקבל מהשרת רק מספרים מצטברים
async function countsFor(s, months) {
  if (canSeeWorkers(s.id) || !isCloud()) return {};
  try { return await db.rpc('site_month_counts', { p_site: s.id, p_from: months[0] + '-01' }) || {}; } catch (e) { console.warn('counts', e); return {}; }
}
const ZERO = { worker_days: 0, work_days: 0, trainings: 0, training_sigs: 0, new_workers: 0 };
export async function monthlyData(s, ym) {
  const months = monthsBack(ym, N);
  const counts = await countsFor(s, months);
  const useCounts = !canSeeWorkers(s.id) && isCloud();
  return months.map(m => siteMonth(S.data, s.id, m, useCounts ? (counts[m] || ZERO) : null));
}

export async function monthlyReport(s) {
  const opts = monthsBack(monthOf(Date.now()), 12).reverse();
  let ym = prevMonth();
  const el = h(`<div class="ov" role="dialog" aria-modal="true"><div class="dlg wide"><div class="dlg-h"><h3>דוח בטיחות חודשי · ${esc(s.name)}</h3><button class="x" aria-label="סגירה" data-x>✕</button></div>
    <div class="dlg-b"><label class="fld"><span>חודש</span><select name="ym">${opts.map(m => `<option value="${m}" ${m === ym ? 'selected' : ''}>${monthName(m)}${m === monthOf(Date.now()) ? ' (עד היום)' : ''}</option>`).join('')}</select></label>
      <div data-body><p class="mut">מחשב…</p></div></div>
    <div class="dlg-f"><button class="btn ghost" data-x>סגירה</button><button class="btn" data-pdf>PDF</button></div></div></div>`);
  document.body.appendChild(el);
  el.querySelectorAll('[data-x]').forEach(b => b.onclick = () => el.remove());
  let rows = [];
  const paint = async () => {
    rows = await monthlyData(s, ym);
    $('[data-body]', el).innerHTML = reportHtml(s, rows);
  };
  $('[name=ym]', el).onchange = e => { ym = e.target.value; paint(); };
  $('[data-pdf]', el).onclick = async e => {
    const win = window.open('', '_blank'); e.target.disabled = true;
    try { const blob = await monthlyPdf(s, rows); const u = URL.createObjectURL(blob); if (win && win.location) win.location.href = u; else window.open(u, '_blank'); }
    catch (x) { win?.close?.(); toast(x.message, 'bad'); }
    e.target.disabled = false;
  };
  paint();
}

function summary(s, rows) {
  const c = rows[rows.length - 1], p = rows[rows.length - 2];
  const L = [];
  L.push(`${c.defNew} ליקויים חדשים (${p.defNew} בחודש הקודם), ${c.defClosed} תוקנו${c.fixDays != null ? `, ${c.fixDays} ימים בממוצע לתיקון` : ''}.`);
  if (c.defOpenEnd) L.push(`בסוף החודש נשארו ${c.defOpenEnd} ליקויים פתוחים${c.defLateEnd ? `, מהם ${c.defLateEnd} באיחור` : ''}.`);
  L.push(c.accidents ? `תועדו ${c.accidents} תאונות.` : 'לא תועדו תאונות.');
  L.push(`${c.bakar} ביקורי בקר בטיחות, ${c.trainings} הדרכות, ${c.eqChecks} בדיקות יומיות לציוד${c.eqFail ? ` (${c.eqFail} נכשלו)` : ''}.`);
  if (c.workDays) L.push(`${c.workDays} ימי עבודה, ${c.avgWorkers} עובדים בממוצע ביום.`);
  return L;
}
function reportHtml(s, rows) {
  const c = rows[rows.length - 1], p = rows[rows.length - 2], comp = compliance(s.id), ex = exceptions(S.data, [s]);
  const k = (v, l) => `<div class="kpi"><div class="l">${l}</div><div class="v">${v}</div></div>`;
  return `<div class="kpis mkpis">${k(comp.pct + '%', 'עמידה בחובות היום')}${k(ex.filter(x => ['crit', 'red'].includes(x.level)).length, 'חריגות פתוחות היום')}
      ${k(c.defOpenEnd, `ליקויים פתוחים בסוף ${esc(monthName(c.ym))}`)}${k(c.accidents, `תאונות ב${esc(monthName(c.ym))}`)}</div>
    <div class="card"><h3>בקצרה: ${esc(monthName(c.ym))}</h3>${summary(s, rows).map(l => `<p class="small">${esc(l)}</p>`).join('')}</div>
    <div class="card"><h3>מגמה: ${N} חודשים</h3><div class="tbl-wrap trend-wrap"><table class="tbl trend"><thead><tr><th></th>${rows.map(r => `<th>${esc(monthName(r.ym))}</th>`).join('')}<th>מול החודש הקודם</th></tr></thead>
      <tbody>${TREND_ROWS.map(([l, k, g]) => `<tr><td>${esc(l)}</td>${rows.map(r => `<td>${r[k] ?? '—'}</td>`).join('')}<td class="${/שיפור/.test(arrow(c[k], p[k], g)) ? 'pos' : /הרעה/.test(arrow(c[k], p[k], g)) ? 'neg' : ''}">${arrow(c[k], p[k], g)}</td></tr>`).join('')}</tbody></table></div></div>
    <div class="card"><h3>ליקויים לפי אחראי לתיקון: ${esc(monthName(c.ym))}</h3>${c.byResp.length ? `<div class="tbl-wrap"><table class="tbl itbl"><thead><tr><th>אחראי</th><th>נפתחו</th><th>תוקנו</th><th>באיחור</th></tr></thead><tbody>${c.byResp.map(r => `<tr><td data-l="אחראי">${esc(r.name)}</td><td data-l="נפתחו">${r.created}</td><td data-l="תוקנו">${r.closed}</td><td data-l="באיחור" class="${r.late ? 'neg' : ''}">${r.late}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty small">לא נפתחו ליקויים בחודש</div>'}</div>
    ${!canSeeWorkers(s.id) ? '<p class="small mut">נתוני עובדים, נוכחות והדרכות מוצגים כמספרים בלבד. פרטי העובדים גלויים רק לצד הקבלן ולבקר.</p>' : ''}`;
}

export async function monthlyPdf(s, rows) {
  const c = rows[rows.length - 1], p = rows[rows.length - 2], comp = compliance(s.id);
  const blocks = [
    { type: 'title', text: 'דוח בטיחות חודשי ליזם', brand: 'צי הנדסה', sub: `${s.name}${s.address ? ', ' + s.address : ''} · ${monthName(c.ym)}` },
    { type: 'kv', rows: [['היזם', siteOrgs(s.id, 'developer').map(o => o.name).join(', ') || '—'], ['מבצע הבנייה', conNames(s.id).join(', ') || '—'], ['עמידה בחובות (נכון להיום)', comp.pct + '%']] },
    { type: 'p', text: 'בקצרה', bold: true, size: 24, color: '#1C3A5E' },
    ...summary(s, rows).map(t => ({ type: 'p', text: t })),
    { type: 'p', text: `מגמה: ${N} חודשים`, bold: true, size: 24, color: '#1C3A5E' },
    { type: 'table', cols: [{ h: '', w: 0.28 }, ...rows.map(r => ({ h: monthName(r.ym), w: 0.56 / rows.length })), { h: 'מול הקודם', w: 0.16 }],
      rows: TREND_ROWS.map(([l, k, g]) => [l, ...rows.map(r => String(r[k] ?? '—')), arrow(c[k], p[k], g)]) },
    { type: 'p', text: `ליקויים לפי אחראי לתיקון: ${monthName(c.ym)}`, bold: true, size: 24, color: '#1C3A5E' },
    c.byResp.length ? { type: 'table', cols: [{ h: 'אחראי', w: 0.46 }, { h: 'נפתחו', w: 0.18 }, { h: 'תוקנו', w: 0.18 }, { h: 'באיחור', w: 0.18 }], rows: c.byResp.map(r => [r.name, String(r.created), String(r.closed), String(r.late)]) }
      : { type: 'p', text: 'לא נפתחו ליקויים בחודש', color: '#666' },
    { type: 'p', size: 15, color: '#666', text: `הופק ממערכת ניהול הבטיחות של צי הנדסה, ${fmtDT(new Date().toISOString())}. המספרים נכונים לרגע ההפקה ומבוססים על מה שתועד במערכת.` }
  ];
  return pagesToPdf(await renderPdfPages(blocks, `${s.name} · דוח בטיחות חודשי · ${monthName(c.ym)}`));
}
