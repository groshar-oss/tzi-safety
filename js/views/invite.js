// הזמנה לאפליקציה בקישור (חבילה 1.10)
// מי שממנה בעלי תפקידים באתר יוצר קישור אישי לתפקיד מסוים. המוזמן ממלא פרטים, מצרף תעודה אם התפקיד דורש ובוחר סיסמה.
// הגישה נפתחת רק אחרי שמנהל המערכת מאשר (invite_decide בשרת בודק את זה)
import { db, isCloud } from '../db.js';
import { S, isAdmin, hasRole, render } from '../app.js';
import { ROLES, ASSIGNABLE, SIDE_OF } from '../duties.js';
import { esc, h, $, $$, toast, modal, field, select, area, fileField } from '../util.js';
import { waShare, mailtoLink, appUrl } from '../alerts.js';
import { shrinkImage } from '../workers.js';

const fmtDT = t => t ? new Date(t).toLocaleString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';

// תעודה לכל תפקיד: [חובה, מה מצרפים]. החובה זהה לשרת (invite_doc_required)
export const DOC = {
  wm: [true, 'תעודת מנהל עבודה או אישור רישום בפנקס מנהלי העבודה'],
  so: [true, 'תעודת ממונה על הבטיחות'],
  bakar: [true, 'תעודת רישום כמהנדס או כהנדסאי בהנדסה אזרחית, או אישור כשירות כממונה על הבטיחות עם אישור השתלמות בבנייה (תקנה 2א(א)(1))'],
  fa: [true, 'תעודת מגיש עזרה ראשונה'],
  sm: [false, 'תעודה או רישיון (לא חובה)'],
  rep: [false, 'תעודת הכשרה אם יש, למשל קורס מנהלי עבודה (לא חובה)'],
  dev: [false, ''], con: [false, '']
};
const LIC = { wm: 'מספר רישום בפנקס מנהלי העבודה', so: 'מספר תעודת ממונה', bakar: 'מספר רישום (מהנדס או הנדסאי) או מספר אישור הכשירות', fa: 'מספר תעודה (אם יש)', sm: 'רישיון או הכשרה (אם יש)',
  rep: 'הכשרה (אם יש)', dev: 'תפקיד בחברה (אם רוצים)', con: 'מספר קבלן רשום (אם יש)' };

export const canInvite = (s, role) => isAdmin() || hasRole(s.id, SIDE_OF[role] === 'dev' ? 'dev' : 'con');
const expired = i => i.status === 'open' && new Date(i.expires_at) < Date.now();
export const invitesOf = siteId => (S.data.site_invites || []).filter(i => !siteId || i.site_id === siteId);
export const pendingInvites = () => invitesOf().filter(i => i.status === 'pending');
const reload = async () => { S.data.site_invites = await db.select('site_invites', { order: 'created_at' }).catch(() => S.data.site_invites || []); };

// ===== יצירת קישור =====
export async function newInvite(s, preset = null) {
  const allowed = Object.fromEntries(ASSIGNABLE.filter(r => canInvite(s, r)).map(r => [r, ROLES[r]]));
  if (!Object.keys(allowed).length) return toast('אין לך הרשאה להזמין בעלי תפקידים לאתר הזה', 'bad');
  const v = await modal({ title: 'הזמנה בקישור', ok: 'יצירת קישור',
    body: `${select('לאיזה תפקיד', 'role', allowed, preset && allowed[preset] ? preset : Object.keys(allowed)[0])}
      ${field('למי (רק לזיהוי שלך)', 'label', '', { attrs: 'placeholder="למשל: יוסי, מנהל העבודה החדש"' })}
      <label class="chk"><input type="checkbox" name="backup"> ממלא מקום (מחליף)</label>
      <p class="small mut">שולחים את הקישור ב-WhatsApp. המוזמן ממלא את הפרטים שלו, מצרף תעודה אם התפקיד דורש, ובוחר סיסמה. הקישור אישי, לשימוש אחד, ובתוקף 3 ימים.</p>
      <div class="banner">הגישה למערכת נפתחת רק אחרי שמנהל המערכת (צי הנדסה) בודק את הפרטים ומאשר.</div>` });
  if (!v) return;
  try {
    const r = await db.rpc('invite_create', { p_site: s.id, p_role: v.role, p_label: v.label.trim() || null, p_backup: !!v.backup });
    await reload(); render();
    inviteDialog(s, v.role, `${appUrl()}#/j/${r.token}`, r.expires_at, v.label.trim());
  } catch (e) { toast(e.message, 'bad'); }
}

function inviteDialog(s, role, url, exp, label) {
  const doc = DOC[role]?.[0] ? `, מצרפים ${DOC[role][1]}` : '';
  const text = `שלום${label ? ' ' + label : ''}, הוזמנת להצטרף למערכת ניהול הבטיחות של צי הנדסה, באתר ${s.name}, בתפקיד ${ROLES[role]}.\nנכנסים לקישור, ממלאים פרטים${doc} ובוחרים סיסמה. אחרי האישור שלנו נכנסים עם האימייל והסיסמה.\nהקישור אישי ובתוקף עד ${fmtDT(exp)}:\n${url}`;
  const el = h(`<div class="ov" role="dialog" aria-modal="true"><div class="dlg"><div class="dlg-h"><h3>קישור ההזמנה מוכן</h3><button class="x" aria-label="סגירה" data-x>✕</button></div>
    <div class="dlg-b"><p class="small"><b>${esc(ROLES[role])}</b> · ${esc(s.name)}${label ? ' · ' + esc(label) : ''}</p>
      <input class="linkbox" dir="ltr" readonly value="${esc(url)}">
      <div class="actions"><a class="btn wa" href="${esc(waShare(text))}" target="_blank" rel="noopener">שליחה ב-WhatsApp</a><button type="button" class="btn ghost" data-copy>העתקה</button><a class="btn ghost" href="${esc(mailtoLink([], 'הזמנה למערכת הבטיחות · ' + s.name, text))}">מייל</a></div>
      <p class="small mut">הקישור מוצג רק עכשיו. אם צריך אותו שוב, יוצרים הזמנה חדשה ומבטלים את הקודמת.</p></div>
    <div class="dlg-f"><button class="btn ghost" data-x>סגירה</button></div></div></div>`);
  document.body.appendChild(el);
  $$('[data-x]', el).forEach(b => b.onclick = () => el.remove());
  $('[data-copy]', el).onclick = async () => { try { await navigator.clipboard.writeText(url); toast('הקישור הועתק'); } catch { $('.linkbox', el).select(); } };
}

// ===== כרטיס בלשונית בעלי תפקידים =====
export function invitesCard(s) {
  const any = ASSIGNABLE.some(r => canInvite(s, r));
  const list = invitesOf(s.id);
  const pending = list.filter(i => i.status === 'pending');
  const open = list.filter(i => i.status === 'open' && !expired(i));
  const recent = list.filter(i => ['rejected'].includes(i.status) && Date.now() - new Date(i.decided_at) < 14 * 864e5);
  if (!any && !pending.length) return '';
  return `<div class="card" data-invites><div class="dh"><h2>הזמנה בקישור</h2>${any ? '<button class="btn small" data-newinv>＋ הזמנה בקישור</button>' : ''}</div>
    <p class="small mut">במקום לרשום מראש את הפרטים: שולחים קישור אישי, המוזמן נרשם בעצמו, ומנהל המערכת מאשר.</p>
    ${pending.map(i => `<div class="wrow inv-p"><div><b>${esc(i.name || '')}</b> <span class="chip amber">ממתין לאישור</span>
        <div class="small mut">${esc(ROLES[i.role] || i.role)}${i.backup ? ' · ממלא מקום' : ''} · נשלח ${fmtDT(i.submitted_at)}${i.has_doc ? ' · צורפה תעודה' : ''}</div>
        <div class="small" dir="ltr">${esc(i.phone || '')} · ${esc(i.email || '')}</div></div>
      <div class="actions">${isAdmin() ? `<button class="btn small" data-review="${i.id}">בדיקה ואישור</button>` : `<span class="small mut">מחכה לאישור מנהל המערכת</span>${i.has_doc ? `<button class="btn small ghost" data-doc="${i.id}">תעודה</button>` : ''}`}${canInvite(s, i.role) ? `<button class="btn small ghost danger" data-revinv="${i.id}">ביטול</button>` : ''}</div></div>`).join('')}
    ${open.map(i => `<div class="wrow"><div><b>${esc(i.label || 'הזמנה')}</b> · ${esc(ROLES[i.role] || i.role)}${i.backup ? ' · ממלא מקום' : ''}
        <div class="small mut">עוד לא נרשם · בתוקף עד ${fmtDT(i.expires_at)} · ${i.open_count ? `נפתח ${i.open_count} פעמים` : 'עוד לא נפתח'}</div></div>
      ${canInvite(s, i.role) ? `<div class="actions"><button class="btn small ghost danger" data-revinv="${i.id}">ביטול</button></div>` : ''}</div>`).join('')}
    ${recent.map(i => `<div class="wrow off"><div><b>${esc(i.name || i.label || '')}</b> <span class="chip">לא אושר</span><div class="small mut">${esc(ROLES[i.role] || i.role)}${i.reject_reason ? ' · ' + esc(i.reject_reason) : ''}</div></div></div>`).join('')}
    ${!pending.length && !open.length && !recent.length ? '<div class="empty small">אין הזמנות פתוחות</div>' : ''}</div>`;
}
export function wireInvites(s, el) {
  $('[data-newinv]', el)?.addEventListener('click', () => newInvite(s));
  $$('[data-review]', el).forEach(b => b.onclick = () => reviewInvite(invitesOf().find(i => i.id === b.dataset.review)));
  $$('[data-doc]', el).forEach(b => b.onclick = () => openDoc(invitesOf().find(i => i.id === b.dataset.doc)));
  $$('[data-pdoc]', el).forEach(b => b.onclick = () => openDoc(invitesOf().find(i => i.person_id === b.dataset.pdoc && i.has_doc)));
  $$('[data-revinv]', el).forEach(b => b.onclick = async () => {
    const i = invitesOf().find(x => x.id === b.dataset.revinv);
    if (!(await modal({ title: 'ביטול ההזמנה', ok: 'ביטול ההזמנה', cancel: 'חזרה', danger: true, body: '<p>הקישור יפסיק לעבוד, ומי שקיבל אותו לא יוכל להירשם דרכו.</p>' }))) return;
    try { await db.rpc('invite_revoke', { p_id: i.id }); await reload(); render(); toast('ההזמנה בוטלה'); } catch (e) { toast(e.message, 'bad'); }
  });
}
// בעל תפקיד שנרשם בהזמנה וצירף תעודה
export const personDoc = p => invitesOf(p.site_id).some(i => i.person_id === p.id && i.has_doc);

// ===== התעודה שצורפה =====
async function loadDoc(i) { if (!i?.has_doc) return null; try { return await db.rpc('invite_doc', { p_id: i.id }); } catch (e) { toast(e.message, 'bad'); return null; } }
const isPdf = d => /^data:application\/pdf/.test(d?.data || '');
async function blobUrl(d) { return URL.createObjectURL(await (await fetch(d.data)).blob()); }
async function openDoc(i) {
  const d = await loadDoc(i); if (!d?.data) return toast('לא נמצאה תעודה', 'bad');
  const w = window.open('', '_blank');
  const u = await blobUrl(d);
  if (w) w.location = u; else location.href = u;
}
const docHtml = d => !d?.data ? '<div class="small mut">לא צורפה תעודה</div>'
  : isPdf(d) ? `<button type="button" class="btn ghost" data-opendoc>📄 פתיחת התעודה (PDF)</button>` : `<img class="inv-doc" src="${esc(d.data)}" alt="התעודה שצורפה">`;

// ===== אישור או דחייה: רק מנהל המערכת =====
const sameP = (a, b) => (a.email && b.email && a.email.toLowerCase() === b.email.toLowerCase()) || (a.phone && b.phone && a.phone.replace(/\D/g, '') === b.phone.replace(/\D/g, ''));
const CONFLICT = { bakar: ['wm', 'sm', 'so', 'rep'], sm: ['wm', 'bakar'], wm: ['bakar', 'sm'], so: ['bakar'], rep: ['bakar'] };
export async function reviewInvite(i) {
  if (!i || !isAdmin()) return;
  const s = S.data.sites.find(x => x.id === i.site_id);
  const d = await loadDoc(i);
  const ppl = S.data.site_people.filter(p => p.site_id === i.site_id && p.active !== false);
  const clash = ppl.find(p => (CONFLICT[i.role] || []).includes(p.role) && sameP(i, p));
  const same = ppl.find(p => p.role === i.role && sameP(i, p));
  const v = await modal({ title: 'בקשת הצטרפות', ok: 'אישור והוספה לאתר', cancel: 'סגירה', wide: true,
    body: `<div class="kv small"><span>אתר</span><b>${esc(s?.name || '')}</b><span>תפקיד</span><b>${esc(ROLES[i.role] || i.role)}</b>
        <span>שם</span><b>${esc(i.name)}</b><span>טלפון</span><b dir="ltr">${esc(i.phone || '')}</b><span>אימייל</span><b dir="ltr">${esc(i.email || '')}</b>
        <span>${esc(LIC[i.role] || 'רישיון / הכשרה')}</span><b>${esc(i.license || '—')}</b><span>נשלח</span><b>${fmtDT(i.submitted_at)}</b>
        <span>הקישור נשלח בידי</span><b dir="ltr">${esc(i.created_by_email || '')}</b></div>
      ${DOC[i.role]?.[1] ? `<h4>${esc(DOC[i.role][1])}</h4>${docHtml(d)}` : ''}
      ${clash ? `<div class="banner crit">${esc(clash.name)} כבר ${esc(ROLES[clash.role])} באתר. התקנות אוסרות לכהן בשני התפקידים, והמערכת לא תאשר.</div>` : ''}
      ${same ? `<div class="banner">${esc(same.name)} כבר רשום/ה באתר בתפקיד הזה. האישור לא יוסיף כפילות.</div>` : ''}
      <label class="chk"><input type="checkbox" name="backup" ${i.backup ? 'checked' : ''}> ממלא מקום (מחליף)</label>
      <p class="small mut">באישור: ${esc(i.name)} נוסף/ת לבעלי התפקידים באתר, מקבל/ת מייל, ומאז נכנס/ת עם האימייל והסיסמה שבחר/ה.${i.role === 'rep' ? ' אחר כך חותמים איתו/ה על כתב הסמכה.' : ''}</p>
      <div class="actions"><button type="button" class="btn ghost danger" data-reject>דחיית הבקשה</button></div>`,
    onMount: (el, close) => {
      $('[data-opendoc]', el)?.addEventListener('click', async () => { const u = await blobUrl(d); window.open(u, '_blank'); });
      $('[data-reject]', el).onclick = () => { close(null); rejectInvite(i); };
    } });
  if (!v) return;
  try {
    await db.rpc('invite_decide', { p_id: i.id, p_ok: true, p_reason: null, p_backup: !!v.backup });
    S.data.site_people = await db.select('site_people', { order: 'created_at' });
    await reload(); render();
    toast(`${i.name} אושר/ה ונוסף/ה לאתר`);
  } catch (e) { toast(e.message, 'bad'); }
}
async function rejectInvite(i) {
  const v = await modal({ title: 'דחיית בקשת הצטרפות', ok: 'דחייה', danger: true,
    body: `<p>${esc(i.name)} · ${esc(ROLES[i.role] || i.role)}</p>${area('סיבה (תופיע במייל למוזמן)', 'reason', '')}` });
  if (!v) return;
  try { await db.rpc('invite_decide', { p_id: i.id, p_ok: false, p_reason: v.reason.trim() || null, p_backup: null }); await reload(); render(); toast('הבקשה נדחתה'); } catch (e) { toast(e.message, 'bad'); }
}

// ===== מסך הבית של מנהל המערכת =====
export function pendingBanner() {
  if (!isAdmin()) return '';
  const p = pendingInvites(); if (!p.length) return '';
  const site = id => S.data.sites.find(s => s.id === id)?.name || '';
  return `<div class="banner inv-banner">🔔 ${p.length === 1 ? 'בקשת הצטרפות אחת ממתינה' : `${p.length} בקשות הצטרפות ממתינות`} לאישור שלך
    ${p.map(i => `<div class="inv-line"><span><b>${esc(i.name)}</b> · ${esc(ROLES[i.role] || i.role)} · ${esc(site(i.site_id))}</span><button class="btn small" data-review="${i.id}">בדיקה ואישור</button></div>`).join('')}</div>`;
}
export function wirePending(el) { $$('.inv-banner [data-review]', el).forEach(b => b.onclick = () => reviewInvite(invitesOf().find(i => i.id === b.dataset.review))); }

// ===== משתמש שנרשם ועוד לא אושר =====
export async function myInviteStatus() {
  try { return await db.rpc('invite_mine', {}); } catch { return []; }
}

// ===== עמוד ההרשמה של המוזמן (בלי כניסה) =====
const STATUS_MSG = {
  pending: r => `<div class="big-ok">✓</div><h2>הבקשה נשלחה</h2><p>${r.name ? esc(r.name) + ', ' : ''}הפרטים שלך ממתינים לאישור מנהל המערכת. כשהבקשה תאושר יישלח אליך מייל${r.email ? ` ל-<span dir="ltr">${esc(r.email)}</span>` : ''}, ומאז נכנסים עם האימייל והסיסמה שבחרת.</p>`,
  approved: () => `<div class="big-ok">✓</div><h2>הבקשה אושרה</h2><p>נכנסים עם האימייל והסיסמה שבחרת.</p><a class="btn" href="./#/">כניסה למערכת</a>`,
  rejected: r => `<h2>הבקשה לא אושרה</h2>${r.reject_reason ? `<p>${esc(r.reject_reason)}</p>` : ''}<p class="small mut">אפשר לפנות למי ששלח לך את הקישור.</p>`
};
export function joinPage(token, r, page) {
  if (r.status !== 'open') { page(`<div class="card pub-msg ${r.status !== 'rejected' ? 'ok' : ''}">${STATUS_MSG[r.status]?.(r) || ''}</div>`); return; }
  const [req, docLabel] = DOC[r.role] || [false, ''];
  const el = page(`<div class="card pub-head"><h1>הצטרפות למערכת הבטיחות</h1><div class="sub">${esc(r.site)}${r.address ? ', ' + esc(r.address) : ''}</div>
      <div class="small">תפקיד: <b>${esc(ROLES[r.role] || r.role)}</b></div></div>
    <form class="card join" novalidate>
      ${field('שם מלא', 'name', '', { req: true, attrs: 'autocomplete="name"' })}
      ${field('טלפון נייד', 'phone', '', { type: 'tel', req: true, attrs: 'dir="ltr" autocomplete="tel" placeholder="050-0000000"' })}
      ${field('אימייל', 'email', '', { type: 'email', req: true, attrs: 'dir="ltr" autocomplete="email"' })}
      ${field(LIC[r.role] || 'רישיון / הכשרה', 'license', '')}
      ${docLabel ? fileField(esc(docLabel), 'doc', { req, note: 'מצלמים את התעודה או מצרפים תמונה או PDF' }) : ''}
      <div class="grid g2">${field('סיסמה (8 תווים לפחות)', 'pw', '', { type: 'password', req: true, attrs: 'dir="ltr" autocomplete="new-password"' })}${field('הסיסמה שוב', 'pw2', '', { type: 'password', req: true, attrs: 'dir="ltr" autocomplete="new-password"' })}</div>
      <p class="small mut">עם האימייל והסיסמה האלה תיכנס למערכת. הגישה נפתחת אחרי שמנהל המערכת בודק את הפרטים ומאשר.</p>
      <div class="err" hidden></div>
      <div class="actions"><button class="btn" type="submit" data-send>שליחת הבקשה</button></div>
    </form>
    <p class="small mut pub-foot">הקישור אישי ובתוקף עד ${esc(fmtDT(r.expires_at))}. הפרטים נשמרים במערכת ניהול הבטיחות של צי הנדסה ומשמשים רק לניהול הבטיחות באתר.</p>`);
  document.title = 'הצטרפות · ' + (r.site || '');
  const form = $('form', el), err = m => { const b = $('.err', form); b.textContent = m || ''; b.hidden = !m; if (m) b.scrollIntoView({ block: 'center' }); };
  form.onsubmit = async e => {
    e.preventDefault(); err('');
    const v = Object.fromEntries(['name', 'phone', 'email', 'license', 'pw', 'pw2'].map(k => [k, (form[k]?.value || '').trim()]));
    v.email = v.email.toLowerCase();
    if (v.name.length < 2) return err('צריך שם מלא');
    if (v.phone.replace(/\D/g, '').length < 9) return err('צריך מספר טלפון נייד');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.email)) return err('האימייל לא תקין');
    const file = form.doc?.files?.[0];
    if (req && !file) return err('צריך לצרף את ' + docLabel);
    if (form.pw.value.length < 8) return err('הסיסמה צריכה 8 תווים לפחות');
    if (form.pw.value !== form.pw2.value) return err('שתי הסיסמאות לא זהות');
    const btn = $('[data-send]', form); btn.disabled = true; btn.textContent = 'שולח…';
    try {
      let doc = null;
      if (file) {
        if (!/^image\/|application\/pdf/.test(file.type)) throw new Error('אפשר לצרף תמונה או PDF');
        const f = /^image\//.test(file.type) ? await shrinkImage(file, 2000, 0.85) : file;
        if (f.size > 5 * 1024 * 1024) throw new Error('הקובץ גדול מדי (עד 5MB). אפשר לצלם במקום לצרף');
        doc = await new Promise((ok, no) => { const fr = new FileReader(); fr.onload = () => ok(fr.result); fr.onerror = () => no(new Error('הקובץ לא נקרא')); fr.readAsDataURL(f); });
        doc = { data: doc, name: f.name || 'צילום' };
      }
      await db.rpc('invite_submit', { p_token: token, p_name: v.name, p_phone: v.phone, p_email: v.email, p_license: v.license || null,
        p_doc: doc?.data || null, p_doc_name: doc?.name || null, p_ua: navigator.userAgent.slice(0, 300) });
      // יצירת המשתמש (שם משתמש וסיסמה). בלי אישור מנהל המערכת אין לו גישה לשום אתר
      let acc = 'demo';
      if (isCloud()) {
        if (db.user && (db.user.email || '').toLowerCase() === v.email) acc = 'exists';
        else {
          if (db.user) await db.signOut();
          acc = await db.signUp(v.email, form.pw.value);
        }
      }
      donePage(page, v, acc);
    } catch (x) { err(x.offline ? 'אין חיבור לאינטרנט. הפרטים לא נשלחו. צריך לנסות שוב כשיש קליטה.' : x.message); btn.disabled = false; btn.textContent = 'שליחת הבקשה'; }
  };
}
function donePage(page, v, acc) {
  const steps = acc === 'confirm_email'
    ? `<ol class="join-steps"><li>נשלח אליך מייל לאימות הכתובת (לפעמים באנגלית, "Confirm your signup"). פותחים אותו ולוחצים על הקישור.</li><li>מנהל המערכת בודק את הפרטים ומאשר. כשזה קורה מגיע אליך מייל.</li><li>מאז נכנסים לאפליקציה עם האימייל והסיסמה שבחרת.</li></ol><p class="small mut">לא הגיע מייל אימות? בודקים בתיקיית הספאם.</p>`
    : acc === 'exists'
      ? `<p>כבר יש לך משתמש במערכת עם האימייל הזה, ולכן הסיסמה הקודמת שלך נשארת (מה שכתבת עכשיו לא נשמר). אחרי האישור נכנסים כרגיל. שכחת את הסיסמה? במסך הכניסה לוחצים "שכחתי סיסמה".</p>`
      : `<p>מנהל המערכת בודק את הפרטים ומאשר. כשזה קורה מגיע אליך מייל, ומאז נכנסים עם האימייל והסיסמה שבחרת.</p>`;
  page(`<div class="card pub-msg ok"><div class="big-ok">✓</div><h2>הבקשה נשלחה</h2><p>תודה, ${esc(v.name)}.</p>${steps}</div>`);
}
