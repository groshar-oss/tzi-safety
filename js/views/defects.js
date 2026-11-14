// ליקויי בטיחות: כל ליקוי עם צילום לפני, אחראי ומועד תיקון. נסגר רק עם צילום אחרי
import { db, uuid } from '../db.js';
import { S, hasRole, render } from '../app.js';
import { esc, h, $, $$, toast, modal, field, select, area, fmtDate, fileField } from '../util.js';
import { shrinkImage, workersOf } from '../workers.js';
import { fmtDT } from './common.js';

export const SEV = { crit: ['red', 'סיכון מיידי', 0], high: ['amber', 'חמור', 2], normal: ['', 'רגיל', 7] };
export const SRC = { checkin: 'צ׳ק-אין יומי', so: 'סיור ממונה בטיחות', bakar: 'ביקור בקר בטיחות', sm: 'בקרת מנהל אתר', inspector: 'ביקורת מפקח עבודה', equipment: 'בדיקה יומית לציוד', other: 'אחר' };
export const canAddDefect = siteId => hasRole(siteId, 'dev', 'bakar', 'con', 'so', 'sm', 'wm', 'rep');
export const canCloseDefect = siteId => hasRole(siteId, 'con', 'so', 'sm', 'wm', 'rep');
const DAY = 864e5;
const today = () => new Date().toISOString().slice(0, 10);
const addDays = n => new Date(Date.now() + n * DAY).toISOString().slice(0, 10);

export const defectsOf = siteId => (S.data.defects || []).filter(d => d.site_id === siteId);
export const openDefects = siteId => defectsOf(siteId).filter(d => !d.closed_at);
export const isLate = d => !d.closed_at && d.due_date && d.due_date < today();
const sortOpen = (a, b) => (b.severity === 'crit') - (a.severity === 'crit') || String(a.due_date || '').localeCompare(String(b.due_date || ''));

// תמונה ממוזערת: נטענת אחרי הציור
async function thumbs(el) {
  for (const img of $$('img[data-path]', el)) {
    try { const b = await db.getFile(img.dataset.path); img.src = URL.createObjectURL(b); } catch { img.replaceWith(h('<div class="noimg" title="הצילום לא זמין">📷</div>')); }
  }
}
const pic = (path, label) => path ? `<figure class="dpic"><img data-path="${esc(path)}" alt="${esc(label)}"><figcaption>${esc(label)}</figcaption></figure>` : '';

function card(s, d, canClose) {
  const [cl, lb] = SEV[d.severity] || SEV.normal;
  const late = isLate(d);
  return `<div class="wrow defect ${d.closed_at ? 'lv-ok' : late ? 'lv-bad' : ''}" data-def="${d.id}">
    <div class="dbody"><b>${esc(d.title)}</b> <span class="chip ${cl}">${lb}</span>${d.closed_at ? ' <span class="chip green">תוקן</span>' : late ? ' <span class="chip red">באיחור</span>' : ''}${d._pending ? ' <span class="pend">ממתין לשליחה</span>' : ''}
      <div class="small mut">${esc([d.location, SRC[d.source]].filter(Boolean).join(' · '))}</div>
      <div class="small">אחראי: <b>${esc(d.responsible || '—')}</b>${d.closed_at ? ` · תוקן ${fmtDT(d.closed_at)}` : ` · לתקן עד <b class="${late ? 'neg' : ''}">${esc(fmtDate(d.due_date))}</b>`}</div>
      ${d.fix_note ? `<div class="small">מה תוקן: ${esc(d.fix_note)}</div>` : ''}
      <div class="dpics">${pic(d.before_path, 'לפני')}${pic(d.after_path, 'אחרי')}</div></div>
    ${!d.closed_at && canClose ? `<div class="actions"><button class="btn small" data-fix="${d.id}">📷 תוקן: צילום אחרי</button></div>` : ''}</div>`;
}

export function tabDefects(s, focus) {
  const all = defectsOf(s.id);
  const open = all.filter(d => !d.closed_at).sort(sortOpen), closed = all.filter(d => d.closed_at).sort((a, b) => String(b.closed_at).localeCompare(String(a.closed_at)));
  const canClose = canCloseDefect(s.id);
  const el = h(`<div>
    ${canAddDefect(s.id) ? '<div class="fbar"><button class="btn big" data-newdef>📷 ליקוי בטיחות חדש</button></div>' : ''}
    <div class="card"><h2>ליקויים פתוחים <span class="mut small">${open.length}${open.filter(isLate).length ? ` · ${open.filter(isLate).length} באיחור` : ''}</span></h2>
      <p class="small mut">כל ליקוי בטיחות שנמצא באתר: מצלמים, קובעים אחראי ומועד. ליקוי נסגר רק עם צילום אחרי התיקון.</p>
      ${open.map(d => card(s, d, canClose)).join('') || '<div class="empty">אין ליקויים פתוחים 👍</div>'}</div>
    ${closed.length ? `<details class="card"><summary><b>ליקויים שתוקנו</b> <span class="mut small">${closed.length}</span></summary>${closed.map(d => card(s, d, false)).join('')}</details>` : ''}</div>`);
  $('[data-newdef]', el)?.addEventListener('click', () => defectForm(s));
  $$('[data-fix]', el).forEach(b => b.onclick = () => fixForm(s, all.find(d => d.id === b.dataset.fix)));
  el.addEventListener('mounted', () => {
    thumbs(el);
    if (focus) { const r = $(`[data-def="${focus}"]`, el); if (r) { r.classList.add('flash'); r.scrollIntoView({ block: 'center' }); } }
  });
  $$('details', el).forEach(x => x.addEventListener('toggle', () => thumbs(x), { once: true }));
  return el;
}

const companies = s => [...new Set([...S.data.site_orgs.filter(x => x.site_id === s.id).map(x => S.data.orgs.find(o => o.id === x.org_id)?.name), ...workersOf(s.id).map(w => w.company)].filter(Boolean))];

export async function defectForm(s, pre = {}) {
  let form = null;
  const my = S.data.site_people.find(p => p.site_id === s.id && (p.email || '').toLowerCase() === (S.user?.email || '').toLowerCase());
  const defSrc = pre.source || ({ so: 'so', bakar: 'bakar', sm: 'sm' }[my?.role] || 'other');
  const v = await modal({ title: 'ליקוי בטיחות חדש', ok: 'שמירה',
    body: `${fileField('צילום הליקוי (לפני)', 'before', { req: true, accept: 'image/*' })}
      ${field('מה הליקוי', 'title', pre.title || '', { req: true, hint: 'למשל: מעקה חסר בפתח בתקרה' })}
      ${field('איפה', 'location', pre.location || '', { hint: 'קומה, אזור, ציר' })}
      <div class="grid g2">${select('חומרה', 'severity', Object.fromEntries(Object.entries(SEV).map(([k, v]) => [k, v[1]])), pre.severity || 'high')}
        ${select('איך נמצא', 'source', SRC, defSrc)}</div>
      <div class="grid g2">${field('אחראי לתיקון (חברה או קבלן משנה)', 'responsible', pre.responsible || '', { req: true, attrs: 'list="defCmp"' })}
        ${field('לתקן עד', 'due_date', addDays(SEV[pre.severity || 'high'][2]), { type: 'date', req: true })}</div>
      <datalist id="defCmp">${companies(s).map(c => `<option value="${esc(c)}">`).join('')}</datalist>
      <p class="small mut">סיכון מיידי: מפסיקים את העבודה באזור עד התיקון. אם זה סיכון שאינו קביל, מדווחים גם אירוע.</p>`,
    onMount: el => {
      form = $('form', el);
      $('[name=severity]', el).addEventListener('change', e => { $('[name=due_date]', el).value = addDays(SEV[e.target.value][2]); });
    },
    validate: d => !form.elements.before.files[0] ? 'צריך לצלם את הליקוי' : (d.title || '').trim().length < 3 ? 'צריך לכתוב מה הליקוי'
      : !(d.responsible || '').trim() ? 'צריך אחראי לתיקון' : !d.due_date ? 'צריך מועד לתיקון' : d.due_date < today() ? 'מועד התיקון לא יכול להיות בעבר' : null });
  if (!v) return null;
  try {
    toast('שומר…');
    const id = uuid();
    const f = await shrinkImage(form.elements.before.files[0]);
    const path = `${s.id}/defects/${id}/before-${Date.now()}.jpg`;
    await db.putFile(path, f);
    const [d] = await db.insert('defects', { id, site_id: s.id, title: v.title.trim(), location: v.location.trim(), severity: v.severity, source: v.source,
      responsible: v.responsible.trim(), due_date: v.due_date, before_path: path, event_id: pre.event_id || null });
    (S.data.defects ||= []).push(d);
    toast('הליקוי נרשם');
    location.hash = `#/site/${s.id}/defects/${d.id}`; render();
    return d;
  } catch (e) { toast(e.message, 'bad'); return null; }
}

async function fixForm(s, d) {
  let form = null;
  const v = await modal({ title: 'סגירת ליקוי: ' + d.title, ok: 'סגירת הליקוי',
    body: `${fileField('צילום אחרי התיקון', 'after', { req: true, accept: 'image/*' })}
      ${area('מה תוקן', 'fix_note')}
      <p class="small mut">ליקוי נסגר רק עם צילום אחרי. הצילום, השעה ומי סגר נשמרים ולא ניתנים לשינוי.</p>`,
    onMount: el => { form = $('form', el); },
    validate: x => !form.elements.after.files[0] ? 'צריך לצלם אחרי התיקון' : (x.fix_note || '').trim().length < 3 ? 'צריך לכתוב בקצרה מה תוקן' : null });
  if (!v) return;
  try {
    toast('שומר…');
    const f = await shrinkImage(form.elements.after.files[0]);
    const path = `${s.id}/defects/${d.id}/after-${Date.now()}.jpg`;
    await db.putFile(path, f);
    const r = await db.update('defects', d.id, { after_path: path, fix_note: v.fix_note.trim(), closed_at: new Date().toISOString() });
    Object.assign(d, r);
    // ציוד שנעצר בגלל הליקוי הזה חוזר לשימוש
    const eq = (S.data.equipment || []).find(e => e.stop_use && e.stop_defect_id === d.id);
    if (eq) { try { const x = await db.update('equipment', eq.id, { stop_use: false, stop_defect_id: null, stop_reason: null, stop_at: null }); Object.assign(eq, x); toast(`הליקוי נסגר, ו${eq.name} חזר לשימוש`); render(); return; } catch (x) { toast('הליקוי נסגר, אבל החזרת הציוד לשימוש נכשלה: ' + x.message, 'bad'); } }
    toast('הליקוי נסגר'); render();
  } catch (e) { toast(e.message, 'bad'); }
}

// לשורות של מסך השטח, הסקירה והביקורת
export function defectSummary(siteId) {
  const o = openDefects(siteId);
  return { open: o.length, late: o.filter(isLate).length, crit: o.filter(d => d.severity === 'crit').length };
}
