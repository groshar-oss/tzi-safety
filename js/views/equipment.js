// ציוד ותסקירים: מכונות הרמה ואביזרי הרמה, תסקיר אחרון ומועד הבדיקה הבאה. כל תסקיר נשמר כשורה (היסטוריה מלאה)
import { db, uuid } from '../db.js';
import { S, hasRole, syncSite, render } from '../app.js';
import { esc, h, $, $$, toast, modal, field, select, area, fmtDate, fileField } from '../util.js';
import { EQUIP_KINDS, equipmentOf, inspectionsOf, lastInspection, nextDueFor, putEquipFile, israelDay, shrinkImage } from '../workers.js';
import { openFile } from './common.js';
import { isCloud } from '../db.js';

export const canEquip = siteId => hasRole(siteId, 'con', 'so', 'sm', 'wm', 'rep');
const DAY = 864e5;
function eqStatus(e, now = Date.now()) {
  if (e.active === false) return ['', 'לא בשימוש'];
  if (e.stop_use) return ['red', 'אסור להפעיל'];
  const li = lastInspection(e.id);
  if (!li) return ['red', 'אין תסקיר'];
  const left = new Date(li.next_due + 'T23:59:59').getTime() - now;
  return left < 0 ? ['red', 'התסקיר פג'] : left <= 30 * DAY ? ['amber', `פג בעוד ${Math.ceil(left / DAY)} ימים`] : ['green', 'בתוקף'];
}

export function tabEquipment(s, c) {
  const can = canEquip(s.id);
  const list = equipmentOf(s.id).slice().sort((a, b) => (a.active === false) - (b.active === false) || String(lastInspection(a.id)?.next_due || '').localeCompare(String(lastInspection(b.id)?.next_due || '')));
  const el = h(`<div>
    ${can ? `<div class="fbar"><button class="btn big" data-add>＋ ציוד חדש</button>${list.some(e => e.active !== false) ? '<button class="btn big ghost" data-dailyall>✓ בדיקה יומית</button>' : ''}</div>` : ''}
    <div class="card"><h2>ציוד ותסקירים <span class="mut small">${list.filter(e => e.active !== false).length}</span></h2>
      <p class="small mut">מכונת הרמה: תסקיר בודק מוסמך לפני שימוש ראשון ולפחות אחת ל-14 חודשים (סעיפים 76, 81 לפקודת הבטיחות בעבודה). שרשראות, חבלים ואביזרי הרמה: לפחות אחת ל-6 חודשים (סעיף 75). התראה נשלחת 30 יום לפני שהתסקיר פג.</p>
      ${list.map(e => { const li = lastInspection(e.id), [cl, lb] = eqStatus(e); return `<div class="wrow ${e.active === false ? 'off' : ''}" data-eq="${e.id}"><div>
        <b>${esc(e.name)}</b>${e.ident ? ` <span class="mut" dir="ltr">${esc(e.ident)}</span>` : ''} <span class="chip ${cl}">${esc(lb)}</span>
        <div class="small mut">${esc(EQUIP_KINDS[e.kind]?.label || e.kind)}${e.owner ? ' · ' + esc(e.owner) : ''}</div>
        ${e.stop_use ? `<div class="small neg">⛔ אסור להפעיל: ${esc(e.stop_reason || 'נכשל בבדיקה היומית')}${e.stop_defect_id ? ` · <a href="#/site/${s.id}/defects/${e.stop_defect_id}">הליקוי</a>` : ''}</div>` : ''}
        ${e.active !== false ? `<div class="small">${dailyLine(e)}</div>` : ''}
        <div class="small">${li ? `תסקיר ${esc(fmtDate(li.inspected_at))} · ${esc(li.inspector)} · הבא עד <b>${esc(fmtDate(li.next_due))}</b>` : '<span class="neg">אין תסקיר. אסור להשתמש עד שיש תסקיר בתוקף.</span>'}</div></div>
        <div class="actions">${can && e.active !== false ? `<button class="btn small" data-daily="${e.id}">✓ בדיקה יומית</button>` : ''}${can && e.stop_use && stopFixed(e) ? `<button class="btn small" data-release="${e.id}">החזרה לשימוש</button>` : ''}${li?.cert_path ? `<button class="btn small ghost" data-f="${esc(li.cert_path)}">תסקיר</button>` : ''}${can && e.active !== false ? `<button class="btn small" data-insp="${e.id}">תסקיר חדש</button>` : ''}<button class="btn small ghost" data-hist="${e.id}">היסטוריה</button></div></div>`; }).join('') || '<div class="empty">לא נרשם ציוד. מוסיפים כל מכונת הרמה ואביזר הרמה שנמצאים באתר.</div>'}</div></div>`);
  $('[data-add]', el)?.addEventListener('click', () => equipForm(s));
  $('[data-dailyall]', el)?.addEventListener('click', () => dailyCheck(s));
  $$('[data-daily]', el).forEach(b => b.onclick = () => dailyCheck(s, equipmentOf(s.id).find(e => e.id === b.dataset.daily)));
  $$('[data-release]', el).forEach(b => b.onclick = () => releaseEquip(s, equipmentOf(s.id).find(e => e.id === b.dataset.release)));
  $$('[data-insp]', el).forEach(b => b.onclick = () => inspForm(s, equipmentOf(s.id).find(e => e.id === b.dataset.insp)));
  $$('[data-f]', el).forEach(b => b.onclick = () => openFile(b.dataset.f));
  $$('[data-hist]', el).forEach(b => b.onclick = () => history(s, equipmentOf(s.id).find(e => e.id === b.dataset.hist)));
  if (c) el.addEventListener('mounted', () => { const r = $(`[data-eq="${c}"]`, el); if (r) { r.classList.add('flash'); r.scrollIntoView({ block: 'center' }); } });
  return el;
}

async function equipForm(s) {
  let form = null;
  const v = await modal({ title: 'ציוד חדש', ok: 'שמירה',
    body: `${select('סוג', 'kind', Object.fromEntries(Object.entries(EQUIP_KINDS).map(([k, x]) => [k, x.label])), 'lift_machine')}
      ${field('שם / תיאור', 'name', '', { req: true, attrs: 'placeholder="למשל: מלגזה טלסקופית, עגורן צריח, סט רצועות הרמה"' })}
      <div class="grid g2">${field('מספר זיהוי / סידורי', 'ident', '', { attrs: 'dir="ltr"' })}${field('בעלים / ספק', 'owner', '')}</div>
      <h3>התסקיר האחרון</h3>
      <div class="grid g2">${field('תאריך הבדיקה', 'inspected_at', '', { type: 'date' })}${field('בתוקף עד', 'next_due', '', { type: 'date', hint: 'מתמלא לבד לפי הסוג. אם בתסקיר כתוב מועד מוקדם יותר, משנים' })}</div>
      ${field('הבודק המוסמך', 'inspector', '')}
      ${fileField('צילום / PDF של התסקיר', 'cert')}
      <p class="small mut">אפשר לשמור בלי תסקיר, אבל הציוד יסומן "אין תסקיר" ותיפתח התראה קריטית עד שמזינים אותו.</p>`,
    onMount: el => { const upd = () => { const k = $('[name=kind]', el).value, d = $('[name=inspected_at]', el).value; if (d && nextDueFor(k, d)) $('[name=next_due]', el).value = nextDueFor(k, d); };
      $('[name=kind]', el).addEventListener('change', upd); $('[name=inspected_at]', el).addEventListener('change', upd); },
    validate: (d, f) => { form = f; if (!d.name?.trim()) return 'צריך שם'; if (d.inspected_at) return inspCheck(d, f, true); return null; } });
  if (!v) return;
  try {
    const id = uuid();
    const [e] = await db.insert('equipment', { id, site_id: s.id, kind: v.kind, name: v.name.trim(), ident: v.ident.trim(), owner: v.owner.trim(), active: true });
    (S.data.equipment ||= []).push(e);
    if (v.inspected_at) await saveInsp(s, e, v, form);
    await syncSite(s, false); toast('הציוד נשמר'); render();
  } catch (x) { toast(x.message, 'bad'); }
}
function inspCheck(d, f) {
  if (!d.inspected_at || !d.next_due) return 'צריך תאריך בדיקה ותוקף';
  if (d.inspected_at > new Date().toISOString().slice(0, 10)) return 'תאריך הבדיקה בעתיד';
  if (d.next_due <= d.inspected_at) return 'התוקף צריך להיות אחרי תאריך הבדיקה';
  const max = nextDueFor(d.kind, d.inspected_at);
  if (max && d.next_due > max) return `לפי הסוג, התוקף לכל היותר עד ${fmtDate(max)}`;
  if (!d.inspector?.trim()) return 'צריך את שם הבודק המוסמך';
  if (!f.cert.files[0]) return 'צריך לצרף צילום או PDF של התסקיר';
  return null;
}
async function saveInsp(s, e, v, form) {
  const file = form?.elements?.cert?.files?.[0];
  const cert_path = file ? await putEquipFile(s.id, e.id, file) : null;
  const [r] = await db.insert('inspections', { site_id: s.id, equipment_id: e.id, inspected_at: v.inspected_at, next_due: v.next_due, inspector: v.inspector.trim(), cert_path, note: (v.note || '').trim() });
  (S.data.inspections ||= []).push(r);
}
async function inspForm(s, e) {
  let form = null;
  const v = await modal({ title: `תסקיר חדש · ${e.name}`, ok: 'שמירה',
    body: `<input type="hidden" name="kind" value="${esc(e.kind)}">
      <div class="grid g2">${field('תאריך הבדיקה', 'inspected_at', new Date().toISOString().slice(0, 10), { type: 'date', req: true })}${field('בתוקף עד', 'next_due', nextDueFor(e.kind, new Date().toISOString().slice(0, 10)), { type: 'date', req: true })}</div>
      ${field('הבודק המוסמך', 'inspector', lastInspection(e.id)?.inspector || '', { req: true })}
      ${fileField('צילום / PDF של התסקיר', 'cert', { req: true })}
      ${area('הערות הבודק (אם יש)', 'note')}`,
    onMount: el => $('[name=inspected_at]', el).addEventListener('change', x => { const n = nextDueFor(e.kind, x.target.value); if (n) $('[name=next_due]', el).value = n; }),
    validate: (d, f) => { form = f; return inspCheck(d, f); } });
  if (!v) return;
  try { await saveInsp(s, e, v, form); await syncSite(s, false); toast('התסקיר נשמר'); render(); } catch (x) { toast(x.message, 'bad'); }
}
function history(s, e) {
  const rows = inspectionsOf(e.id);
  modal({ title: `היסטוריית תסקירים · ${e.name}`, ok: null, cancel: 'סגירה',
    body: rows.map(r => `<div class="wrow"><div><b>${esc(fmtDate(r.inspected_at))}</b> · ${esc(r.inspector)} · עד ${esc(fmtDate(r.next_due))}${r.note ? `<div class="small">${esc(r.note)}</div>` : ''}<div class="small mut">נרשם ${esc(fmtDate(r.created_at))} · ${esc(r.created_by_email || '')}</div></div>${r.cert_path ? `<button type="button" class="btn small ghost" data-f="${esc(r.cert_path)}">תסקיר</button>` : ''}</div>`).join('') || '<div class="empty">אין תסקירים</div>'
      + (canEquip(s.id) && e.active !== false ? '<p><button type="button" class="btn small ghost" data-off>הציוד יצא מהאתר</button></p>' : ''),
    onMount: (el, close) => {
      $$('[data-f]', el).forEach(b => b.onclick = () => openFile(b.dataset.f));
      $('[data-off]', el)?.addEventListener('click', async () => { try { const r = await db.update('equipment', e.id, { active: false }); Object.assign(e, r); close(null); await syncSite(s, false); toast('סומן שהציוד יצא מהאתר'); render(); } catch (x) { toast(x.message, 'bad'); } });
    } });
}

// ===== בדיקה יומית לפני הפעלה =====
// רשימת בדיקה מעשית לפי סוג הציוד. לא מחליפה את הוראות היצרן, את התסקיר של בודק מוסמך ואת ההכשרה של המפעיל
export const DAILY = {
  lift_machine: ['בלמים וברקסים פועלים', 'מפסקי גבול, מגביל עומס ואזעקות פועלים', 'אין דליפת שמן, סולר או נוזל הידראולי', 'כבלים, שרשראות ווים: בלי נזק, סדק או שחיקה נראים לעין', 'צמיגים, זחלים ומייצבים (רגליים) תקינים', 'שלט העומס המותר קריא ונמצא על הכלי', 'צופר, אורות, מראות ומצלמות פועלים', 'אזור העבודה מגודר ופנוי מאנשים, אין קווי חשמל קרובים'],
  lift_gear: ['תג זיהוי ועומס מותר קריאים', 'רצועות וחבלים: בלי קרע, חתך, שחיקה או כוויה', 'שרשרת: בלי חוליה מעוותת, סדוקה או מתוחה', 'וו עם תפס בטיחות תקין', 'סגרים (שאקלים): פין שלם ומוברג עד הסוף'],
  other: ['הציוד שלם, בלי נזק נראה לעין', 'אמצעי הבטיחות והמגנים של הציוד במקומם ופועלים', 'אין דליפות, חוטים חשופים או חלקים רופפים']
};
const checksOf = eid => (S.data.equipment_checks || []).filter(c => c.equipment_id === eid).sort((a, b) => String(b.day).localeCompare(String(a.day)) || String(b.created_at).localeCompare(String(a.created_at)));
export const checkedToday = e => checksOf(e.id).find(c => c.day === israelDay());
function dailyLine(e) {
  const c = checksOf(e.id)[0];
  if (!c) return '<span class="mut">בדיקה יומית: עוד לא נבדק</span>';
  return c.day === israelDay() ? (c.ok ? `<span class="ok-t">✓ נבדק היום</span> · ${esc(c.checked_by_name)}` : `<span class="neg">✗ נכשל היום</span> · ${esc(c.checked_by_name)}`)
    : `<span class="mut">בדיקה יומית אחרונה: ${esc(fmtDate(c.day))}${c.ok ? '' : ' (נכשל)'}</span>`;
}
const stopFixed = e => !e.stop_defect_id || !!(S.data.defects || []).find(d => d.id === e.stop_defect_id)?.closed_at;
const myName = s => (S.data.site_people.find(p => p.site_id === s.id && p.active !== false && (p.email || '').toLowerCase() === (S.user?.email || '').toLowerCase())?.name || '').replace(/ \(.*\)$/, '');

export async function dailyCheck(s, pre) {
  const list = equipmentOf(s.id).filter(e => e.active !== false);
  if (!list.length) return toast('לא נרשם ציוד באתר', 'bad');
  let e = pre || list.find(x => !checkedToday(x)) || list[0];
  let form = null;
  const items = k => (DAILY[k] || DAILY.other).map((t, i) => `<div class="dc-row"><span>${esc(t)}</span><span class="dc-opt"><label><input type="radio" name="i${i}" value="ok"> תקין</label><label><input type="radio" name="i${i}" value="bad"> לא תקין</label></span></div>`).join('');
  const v = await modal({ title: 'בדיקה יומית לפני הפעלה', ok: 'שמירה', wide: true,
    body: `${select('הציוד', 'eq', Object.fromEntries(list.map(x => [x.id, x.name + (x.ident ? ' ' + x.ident : '') + (checkedToday(x) ? ' ✓' : '')])), e.id)}
      <div class="dc-list">${items(e.kind)}</div>
      <div class="actions"><button type="button" class="btn small ghost" data-allok>הכול תקין</button></div>
      ${field('מי בדק', 'by', myName(s), { req: true })}
      <div class="dc-bad" hidden>
        <div class="banner crit">פריט לא תקין: הציוד יסומן "אסור להפעיל", וייפתח ליקוי בטיחות. הציוד חוזר לשימוש רק אחרי שהליקוי נסגר עם צילום אחרי התיקון.</div>
        ${fileField('צילום של מה שלא תקין', 'photo', { accept: 'image/*' })}
        ${field('מה בדיוק לא תקין', 'note', '')}
        ${field('אחראי לתיקון (חברה או בעל הציוד)', 'responsible', e.owner || '')}
      </div>
      <p class="small mut">רשימה מעשית לבדיקה לפני הפעלה בכל יום עבודה. היא לא מחליפה את הוראות היצרן, את התסקיר של בודק מוסמך ואת ההסמכה של המפעיל.</p>`,
    onMount: el => {
      form = $('form', el);
      const sync = () => { const bad = $$('.dc-list input[value=bad]', el).some(x => x.checked); $('.dc-bad', el).hidden = !bad; };
      el.addEventListener('change', x => { if (x.target.name === 'eq') { e = list.find(q => q.id === x.target.value); $('.dc-list', el).innerHTML = items(e.kind); $('[name=responsible]', el).value = e.owner || ''; } sync(); });
      $('[data-allok]', el).onclick = () => { $$('.dc-list input[value=ok]', el).forEach(x => { x.checked = true; }); sync(); };
    },
    validate: d => {
      const n = (DAILY[e.kind] || DAILY.other).length;
      for (let i = 0; i < n; i++) if (!d['i' + i]) return 'צריך לסמן כל פריט: תקין או לא תקין';
      if ((d.by || '').trim().length < 2) return 'צריך את שם הבודק';
      const bad = [...Array(n).keys()].some(i => d['i' + i] === 'bad');
      if (bad && !form.elements.photo.files[0]) return 'צריך לצלם את מה שלא תקין';
      if (bad && !(d.responsible || '').trim()) return 'צריך אחראי לתיקון';
      return null;
    } });
  if (!v) return;
  const names = DAILY[e.kind] || DAILY.other;
  const res = names.map((t, i) => ({ item: t, ok: v['i' + i] === 'ok' }));
  const ok = res.every(x => x.ok);
  try {
    toast('שומר…');
    let defect_id = null;
    if (!ok) {
      const failed = res.filter(x => !x.ok).map(x => x.item);
      const id = uuid(), f = await shrinkImage(form.elements.photo.files[0]);
      const path = `${s.id}/defects/${id}/before-${Date.now()}.jpg`;
      await db.putFile(path, f);
      const [d] = await db.insert('defects', { id, site_id: s.id, title: `${e.name}: נכשל בבדיקה יומית. ${failed.join('; ')}`.slice(0, 300), location: e.ident || '', severity: 'crit', source: 'equipment',
        responsible: v.responsible.trim(), due_date: israelDay(), before_path: path, event_id: null });
      (S.data.defects ||= []).push(d);
      defect_id = id;
    }
    const [c] = await db.insert('equipment_checks', { site_id: s.id, equipment_id: e.id, day: israelDay(), items: res, ok, note: (v.note || '').trim() || null, defect_id, checked_by_name: v.by.trim() });
    (S.data.equipment_checks ||= []).push(c);
    if (!ok) {
      // בשרת הציוד נעצר לבד (טריגר). כאן מעדכנים את המסך מיד, ובמצב הדגמה גם שומרים
      const stop = { stop_use: true, stop_defect_id: defect_id, stop_reason: (v.note || '').trim() || 'נכשל בבדיקה היומית', stop_at: new Date().toISOString() };
      if (!isCloud()) await db.update('equipment', e.id, stop);
      Object.assign(e, stop);
      toast('נשמר. הציוד סומן "אסור להפעיל" ונפתח ליקוי', 'bad');
    } else toast('הבדיקה נשמרה: הכול תקין');
    render();
  } catch (x) { toast(x.message, 'bad'); }
}

// החזרה לשימוש: רק אחרי שהליקוי נסגר (נבדק גם בשרת)
export async function releaseEquip(s, e) {
  if (!e?.stop_use) return;
  if (!stopFixed(e)) return toast('קודם סוגרים את הליקוי עם צילום אחרי התיקון', 'bad');
  try { const r = await db.update('equipment', e.id, { stop_use: false, stop_defect_id: null, stop_reason: null, stop_at: null }); Object.assign(e, r); toast('הציוד חזר לשימוש'); render(); } catch (x) { toast(x.message, 'bad'); }
}
