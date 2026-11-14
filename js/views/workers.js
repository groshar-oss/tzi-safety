// פנקס עובדים והדרכות: רישום עובד (תעודה וצילום חובה, גיל 18 ומעלה), כרטיס עובד, הדרכה עם חתימות בטלפון ו-PDF אוטומטי
// עובדים לא נכנסים למערכת. רושם ומדריך: מנהל עבודה, נציג מבצע הבנייה, או מנהל השירות
import { db, uuid } from '../db.js';
import { S, hasRole, syncSite, render } from '../app.js';
import { esc, h, $, $$, toast, modal, field, select, area, fmtDate, fileField } from '../util.js';
import { TRAINING_KINDS, COUNTS_ANNUAL, age, validIsraeliId, workersOf, trainingsOf, sigsOfTraining, sigsOfWorker, lastAnnual, workerStatus,
  putWorkerFile, renderPdfPages, pagesToPdf, loadImg, sha256Hex, israelDay, attendanceOf, isPresent, daysPresent, lastAttendanceDay,
  heightExemption, canExemptHeight, exemptApprover } from '../workers.js';
import { pad } from './sign.js';
import { LANGS, langLabel, langCode, localStatement, reminderText, OK_BTN, SIGN_HERE, LINK_MSG } from '../langs.js';
import { waLink, waShare, appUrl } from '../alerts.js';
import { scanId, natName, natLang } from '../ocr.js';
import { openFile, fmtDT } from './common.js';

export const canSeeWorkers = siteId => hasRole(siteId, 'con', 'so', 'sm', 'wm', 'rep', 'bakar');
export const canRegister = siteId => hasRole(siteId, 'wm', 'rep', 'so');
const today = () => new Date().toISOString().slice(0, 10);
const ST = { ok: ['green', 'מותר לעבוד'], warn: ['amber', 'פג בקרוב'], bad: ['red', 'אסור להעסיק'], off: ['', 'לא פעיל'] };
const stChip = st => `<span class="chip ${ST[st.lv][0]}">${ST[st.lv][1]}</span>`;
const idLabel = w => (w.id_type === 'passport' ? 'דרכון ' : 'ת"ז ') + w.id_number;

// ===== כרטיס חברה (קבלן ראשי או קבלן משנה) =====
const cmpName = w => (w.company || '').trim() || 'בלי חברה';
function companyList(s, all) {
  const act = all.filter(x => x.st.lv !== 'off');
  const by = {};
  for (const x of act) (by[cmpName(x.w)] ||= []).push(x);
  const rows = Object.entries(by).sort((a, b) => b[1].filter(x => x.st.lv === 'bad').length - a[1].filter(x => x.st.lv === 'bad').length || b[1].length - a[1].length);
  if (rows.length < 1) return '';
  return `<div class="card"><h2>חברות באתר <span class="mut small">${rows.length}</span></h2>
    ${rows.map(([c, xs]) => { const bad = xs.filter(x => x.st.lv === 'bad').length, warn = xs.filter(x => x.st.lv === 'warn').length, here = xs.filter(x => isPresent(x.w.id)).length;
      return `<button type="button" class="wrow" data-cmp="${esc(c)}"><div><b>${esc(c)}</b> <span class="mut small">${xs.length} עובדים · ${here} באתר היום</span>
        <div>${bad ? `<span class="chip red">${bad} אסור להעסיק</span>` : ''}${warn ? `<span class="chip amber">${warn} פג בקרוב</span>` : ''}${!bad && !warn ? '<span class="chip green">כולם בסדר</span>' : ''}</div></div><span class="go">‹</span></button>`; }).join('')}</div>`;
}
function companyCard(s, company) {
  const xs = workersOf(s.id).filter(w => w.active !== false && cmpName(w) === company).map(w => ({ w, st: workerStatus(w) }));
  const rank = { bad: 0, warn: 1, ok: 2 };
  xs.sort((a, b) => rank[a.st.lv] - rank[b.st.lv] || a.w.name.localeCompare(b.w.name, 'he'));
  const miss = xs.filter(x => x.st.lv === 'bad' || x.st.lv === 'warn');
  const d30 = xs.reduce((t, x) => t + daysPresent(x.w.id), 0);
  const trained = xs.filter(x => lastAnnual(x.w)).length;
  const text = `שלום, מה חסר אצל העובדים של ${company} באתר ${s.name}:\n\n` + miss.map(x => `• ${x.w.name}: ${x.st.issues.join(', ')}`).join('\n')
    + '\n\nעובד שאסור להעסיק לא נכנס לאתר עד שמשלימים. מביאים את המסמכים למנהל העבודה.';
  const el = h(`<div class="ov" role="dialog" aria-modal="true"><div class="dlg wide"><div class="dlg-h"><h3>${esc(company)}</h3><button class="x" aria-label="סגירה" data-x>✕</button></div>
    <div class="dlg-b">
      <div class="kpis"><div class="kpi"><div class="l">עובדים</div><div class="v">${xs.length}</div></div><div class="kpi"><div class="l">אסור להעסיק</div><div class="v neg">${xs.filter(x => x.st.lv === 'bad').length}</div></div>
        <div class="kpi"><div class="l">הודרכו</div><div class="v">${trained}/${xs.length}</div></div><div class="kpi"><div class="l">ימי עבודה ב-30 יום</div><div class="v">${d30}</div></div></div>
      ${miss.length ? `<div class="todo-box"><b>מה חסר</b>${miss.map(x => `<div class="small"><b>${esc(x.w.name)}</b>: ${esc(x.st.issues.join(' · '))}</div>`).join('')}
        <div class="actions"><a class="btn" target="_blank" rel="noopener" href="${esc(waShare(text))}">📱 שליחת הרשימה בוואטסאפ</a></div></div>` : '<div class="banner">לכל העובדים של החברה יש את כל האישורים 👍</div>'}
      <div class="wlist">${xs.map(({ w, st }) => `<button type="button" class="wrow lv-${st.lv}" data-w="${w.id}"><div><b>${esc(w.name)}</b> ${stChip(st)}${isPresent(w.id) ? ' <span class="chip blue">באתר היום</span>' : ''}
        <div class="small mut">${esc(w.trade || '')} · ${daysPresent(w.id)} ימים ב-30 יום</div></div><span class="go">‹</span></button>`).join('')}</div>
    </div><div class="dlg-f"><button class="btn ghost" data-x>סגירה</button></div></div></div>`);
  document.body.appendChild(el);
  $$('[data-x]', el).forEach(b => b.onclick = () => el.remove());
  $$('[data-w]', el).forEach(b => b.onclick = () => { el.remove(); workerCard(s, b.dataset.w); });
}

// ===== לשונית עובדים והדרכות =====
export function tabWorkers(s, c, d) {
  if (!canSeeWorkers(s.id)) return h('<div class="card empty">פנקס העובדים גלוי לצד הקבלן ולבקר הבטיחות בלבד</div>');
  if (c === 'training' && d) return trainingScreen(s, d);
  if (c === 'attendance') return attendanceScreen(s);
  const can = canRegister(s.id);
  const all = workersOf(s.id).map(w => ({ w, st: workerStatus(w) }));
  const rank = { bad: 0, warn: 1, ok: 2, off: 3 };
  all.sort((a, b) => rank[a.st.lv] - rank[b.st.lv] || a.w.name.localeCompare(b.w.name, 'he'));
  const n = lv => all.filter(x => x.st.lv === lv).length;
  const trs = trainingsOf(s.id);
  const el = h(`<div>
    <div class="fbar">${can ? `<button class="btn big" data-newtr>＋ הדרכה חדשה</button><button class="btn big ghost" data-neww>＋ עובד חדש</button>` : '<p class="small mut">רישום עובדים והדרכות: מנהל העבודה, נציג מבצע הבנייה או מנהל השירות.</p>'}</div>
    <a class="card fsum att-sum" href="#/site/${s.id}/workers/attendance"><h2>נוכחות היום <span class="mut small">${all.filter(x => x.st.lv !== 'off' && isPresent(x.w.id)).length} באתר מתוך ${all.filter(x => x.st.lv !== 'off').length}</span></h2>
      <div class="small">${can ? 'סימון מי נמצא היום באתר ›' : 'מי נמצא היום באתר ›'}</div></a>
    <div class="kpis"><div class="kpi"><div class="l">מותר לעבוד</div><div class="v" style="color:#13804a">${n('ok')}</div></div>
      <div class="kpi"><div class="l">פג בקרוב</div><div class="v" style="color:#e08a00">${n('warn')}</div></div>
      <div class="kpi"><div class="l">אסור להעסיק</div><div class="v neg">${n('bad')}</div></div></div>
    <div class="card"><div class="dh"><h2>עובדים באתר <span class="mut small">${all.filter(x => x.st.lv !== 'off').length}</span></h2></div>
      <input class="search" placeholder="חיפוש לפי שם, חברה או מקצוע" data-q>
      <div class="wlist">${all.map(({ w, st }) => `<button type="button" class="wrow lv-${st.lv}" data-w="${w.id}" data-txt="${esc((w.name + ' ' + (w.company || '') + ' ' + (w.trade || '')).toLowerCase())}">
        <div><b>${esc(w.name)}</b> ${stChip(st)}${isPresent(w.id) ? ' <span class="chip blue">באתר היום</span>' : ''}${w.foreign_worker ? ' <span class="chip">עובד זר</span>' : ''}
          <div class="small mut">${esc([w.company, w.trade].filter(Boolean).join(' · '))}</div>
          ${st.issues.length && st.lv !== 'off' ? `<div class="small ${st.lv === 'bad' ? 'neg' : ''}">${esc(st.issues.join(' · '))}</div>` : ''}</div><span class="go">‹</span></button>`).join('') || '<div class="empty">עוד לא נרשמו עובדים</div>'}</div></div>
    ${companyList(s, all)}
    <div class="card"><h2>הדרכות <span class="mut small">${trs.length}</span></h2>
      ${trs.map(t => { const n2 = sigsOfTraining(t.id).length; return `<a class="wrow" href="#/site/${s.id}/workers/training/${t.id}"><div><b>${esc(TRAINING_KINDS[t.kind] || t.kind)}</b> ${t.closed_at ? '<span class="chip green">הסתיימה</span>' : '<span class="chip amber">פתוחה לחתימות</span>'}
        <div class="small mut">${fmtDT(t.held_at)} · ${esc(t.trainer_name)} · ${n2} חתמו</div><div class="small">${esc(t.topic)}</div></div><span class="go">‹</span></a>`; }).join('') || '<div class="empty">עוד לא נרשמו הדרכות</div>'}</div>
  </div>`);
  $('[data-q]', el).addEventListener('input', e => { const q = e.target.value.trim().toLowerCase(); $$('[data-w]', el).forEach(r => r.hidden = q && !r.dataset.txt.includes(q)); });
  $$('[data-w]', el).forEach(b => b.onclick = () => workerCard(s, b.dataset.w));
  $$('[data-cmp]', el).forEach(b => b.onclick = () => companyCard(s, b.dataset.cmp));
  $('[data-neww]', el)?.addEventListener('click', () => workerForm(s));
  $('[data-newtr]', el)?.addEventListener('click', () => newTraining(s));
  if (c && c !== 'training') el.addEventListener('mounted', () => { if (workersOf(s.id).some(w => w.id === c) && !document.querySelector('.ov')) workerCard(s, c); });
  return el;
}

// ===== רישום ועריכת עובד =====
export async function workerForm(s, w = null, { after } = {}) {
  let form = null;
  const hx = w ? heightExemption(w) : null;
  const v = await modal({ title: w ? 'עדכון עובד' : 'עובד חדש', ok: 'שמירה', wide: true,
    body: `${field('שם מלא', 'name', w?.name || '', { req: true })}
      <div class="grid g2">${select('תעודה מזהה', 'id_type', { il: 'תעודת זהות ישראלית', passport: 'דרכון' }, w?.id_type || 'il')}
        ${field('מספר התעודה', 'id_number', w?.id_number || '', { req: true, attrs: 'dir="ltr" autocomplete="off"' })}</div>
      <div class="grid g2">${field('תאריך לידה', 'birth_date', w?.birth_date || '', { type: 'date', req: true, hint: 'אסור להעסיק באתר בנייה עובד מתחת לגיל 18' })}
        ${fileField('צילום התעודה' + (w?.id_photo_path ? ' (קיים. אפשר להחליף)' : ''), 'id_photo', { req: !w?.id_photo_path, note: 'דרכון: עמוד התמונה. תעודה ביומטרית: הגב. הפרטים ימולאו לבד' })}</div>
      <div class="grid g2">${field('חברה (קבלן ראשי או קבלן משנה)', 'company', w?.company || '', { attrs: 'list="cmpList"' })}${field('מקצוע', 'trade', w?.trade || '')}</div>
      <datalist id="cmpList">${[...new Set([...(S.data.site_orgs.filter(x => x.site_id === s.id).map(x => S.data.orgs.find(o => o.id === x.org_id)?.name)), ...workersOf(s.id).map(x => x.company)].filter(Boolean))].map(c => `<option value="${esc(c)}">`).join('')}</datalist>
      <div class="grid g2">${field('טלפון', 'phone', w?.phone || '', { type: 'tel', attrs: 'dir="ltr"' })}
        ${select('השפה שהעובד מבין', 'language', Object.fromEntries(Object.entries(LANGS).map(([k, v]) => [k, v.he])), w?.language || 'he')}</div>
      <label class="chk"><input type="checkbox" name="foreign_worker" ${w?.foreign_worker ? 'checked' : ''}> עובד זר</label>
      <div class="sub-f" data-for="foreign_worker">
        <div class="grid g2">${field('אזרחות', 'nationality', w?.nationality || '')}${field('תאריך כניסה ראשונה לישראל', 'entry_date', w?.entry_date || '', { type: 'date', req: true })}</div>
        <div class="grid g2">${field('מספר היתר / אשרה', 'permit_no', w?.permit_no || '', { attrs: 'dir="ltr"' })}${field('ההיתר בתוקף עד', 'permit_until', w?.permit_until || '', { type: 'date', req: true })}</div>
        <p class="small mut">הדרכה נוספת של 8 שעות במוסד הכשרה מוכר, בשפת העובד, לפני תום חודש מהכניסה לישראל (תקנה 3א לתקנות ההדרכה):</p>
        <div class="grid g2">${field('תאריך ההדרכה', 'f8_date', w?.f8_date || '', { type: 'date' })}${field('מוסד ההכשרה', 'f8_institution', w?.f8_institution || '')}</div>
        ${fileField('אישור המוסד', 'f8_file')}</div>
      <h3>אישור עבודה בגובה <b class="req">*</b></h3>
      ${hx ? `<div class="banner">העובד הוחרג מאישור עבודה בגובה: ${esc(hx.reason)} (${esc(hx.approver_name || hx.approved_by_email || '')})</div>` : ''}
      <div class="grid g2">${field('האישור בתוקף עד', 'height_until', w?.height_until || '', { type: 'date', hint: 'תקף עד שנתיים (תקנה 6(ג) לתקנות העבודה בגובה)' })}
        ${fileField('צילום האישור' + (w?.height_path ? ' (קיים. אפשר להחליף)' : ''), 'height_file')}</div>
      ${!hx && !w?.height ? `<label class="chk"><input type="checkbox" name="no_height"> אין לעובד אישור כרגע</label>
      <p class="small mut" data-noh hidden>העובד יסומן "אסור להעסיק" עד שמצרפים אישור, או עד ש${esc(exemptApprover(s.id))} מאשר החרגה בכרטיס העובד.</p>` : ''}
      ${w ? `<label class="chk"><input type="checkbox" name="active" ${w.active === false ? '' : 'checked'}> פעיל באתר</label>` : ''}`,
    onMount: el => {
      const sync = () => { $$('.sub-f', el).forEach(b => b.hidden = !$(`[name=${b.dataset.for}]`, el).checked); const nh = $('[name=no_height]', el); if (nh) $('[data-noh]', el).hidden = !nh.checked; };
      $$('[name=foreign_worker],[name=no_height]', el).forEach(x => x.addEventListener('change', sync)); sync();
      // סריקת התעודה: קוראים את שורות ה-MRZ וממלאים שדות ריקים
      const inp = $('[name=id_photo]', el), box = h('<div class="small ocr-st" data-ocr aria-live="polite"></div>');
      (inp.closest('.fld') || inp.parentElement).appendChild(box);
      inp.addEventListener('change', async () => {
        const file = inp.files[0]; if (!file) return;
        box.className = 'small ocr-st mut'; box.textContent = 'קורא את התעודה…';
        try {
          const r = await scanId(file);
          if (!r) { box.className = 'small ocr-st warn'; box.textContent = 'לא הצלחנו לקרוא את התעודה. בדרכון מצלמים את עמוד התמונה עם שתי השורות <<< למטה, ובתעודת זהות ביומטרית את הגב. אפשר גם למלא ידנית.'; return; }
          const f = $('form', el).elements, set = (k, v) => { if (v && f[k] && !String(f[k].value || '').trim()) { f[k].value = v; return true; } return false; };
          const got = [];
          if (r.id_type && !f.id_number.value.trim()) f.id_type.value = r.id_type;
          if (set('id_number', r.number)) got.push('מספר התעודה');
          if (set('birth_date', r.birth_date)) got.push('תאריך לידה');
          if (set('name', r.name)) got.push('שם (באנגלית, אפשר לתקן)');
          if (r.nationality && r.nationality !== 'ISR') {
            const fw = f.foreign_worker; if (fw && !fw.checked) { fw.checked = true; fw.dispatchEvent(new Event('change')); }
            if (set('nationality', natName(r.nationality))) got.push('אזרחות');
            if (natLang(r.nationality) && f.language.value === 'he') { f.language.value = natLang(r.nationality); got.push('שפה'); }
          }
          const bad = r.checks && (!r.checks.number && r.id_type !== 'il' || !r.checks.birth);
          box.className = 'small ocr-st ' + (bad ? 'warn' : 'ok');
          box.textContent = (got.length ? '✓ מולא מהתעודה: ' + got.join(', ') + '. ' : 'הפרטים כבר מולאו. ') + (bad ? 'ספרת הביקורת לא תואמת, כדאי לבדוק את המספר ואת התאריך מול התעודה.' : 'לבדוק שהפרטים נכונים.')
            + (r.expiry && r.expiry < new Date().toISOString().slice(0, 10) ? ` שים לב: התעודה פגה ב-${r.expiry.split('-').reverse().join('.')}.` : '');
        } catch (x) { box.className = 'small ocr-st warn'; box.textContent = x.message || 'הקריאה נכשלה. ממלאים ידנית.'; }
      });
    },
    validate: (d, f) => {
      form = f;
      if (!d.name?.trim()) return 'צריך שם מלא';
      const id = d.id_number.trim();
      if (d.id_type === 'il' && !validIsraeliId(id)) return 'מספר תעודת הזהות לא תקין (ספרת ביקורת)';
      if (d.id_type === 'passport' && id.replace(/\s/g, '').length < 5) return 'צריך מספר דרכון מלא';
      if (workersOf(s.id).some(x => x.id !== w?.id && x.id_type === d.id_type && x.id_number === normId(d.id_type, id))) return 'עובד עם התעודה הזו כבר רשום באתר';
      if (!w?.id_photo_path && !f.id_photo.files[0]) return 'חובה לצרף צילום של התעודה';
      if (!d.birth_date) return 'צריך תאריך לידה';
      if (d.birth_date > today()) return 'תאריך הלידה בעתיד';
      if (age(d.birth_date) < 18) return 'אי אפשר לרשום: העובד מתחת לגיל 18. אסור להעסיק נער באתר בנייה (תקנה 1 ופרט 15 בתוספת לתקנות עבודת הנוער, התשנ"ו-1995).';
      if (d.foreign_worker) {
        if (!d.entry_date || !d.permit_until) return 'לעובד זר צריך תאריך כניסה לישראל ותוקף היתר';
        if (d.f8_date && !d.f8_institution?.trim()) return 'צריך את שם מוסד ההכשרה של הדרכת 8 השעות';
      }
      const hasFile = !!(w?.height_path || f.height_file.files[0]);
      if (d.height_until || f.height_file.files[0]) {
        if (!d.height_until) return 'צריך את תאריך התוקף של אישור העבודה בגובה';
        if (!hasFile) return 'צריך לצלם את אישור העבודה בגובה';
        if ((d.height_until !== w?.height_until || f.height_file.files[0]) && d.height_until < today()) return 'אישור העבודה בגובה כבר פג. צריך אישור בתוקף';
        const max = new Date(); max.setFullYear(max.getFullYear() + 2); max.setDate(max.getDate() + 1);
        if (d.height_until > max.toISOString().slice(0, 10)) return 'אישור עבודה בגובה תקף עד שנתיים. בדקו את התאריך';
      } else if (!hx && !w?.height && !d.no_height) return 'כל עובד באתר צריך אישור עבודה בגובה. מצלמים את האישור, או מסמנים "אין לעובד אישור כרגע"';
      return null;
    } });
  if (!v) return;
  const wid = w?.id || uuid();
  const row = { site_id: s.id, name: v.name.trim(), id_type: v.id_type, id_number: normId(v.id_type, v.id_number), birth_date: v.birth_date,
    company: v.company.trim(), trade: v.trade.trim(), phone: v.phone.trim(), language: v.language || 'he', foreign_worker: !!v.foreign_worker,
    nationality: v.foreign_worker ? v.nationality.trim() : null, entry_date: v.foreign_worker ? v.entry_date || null : null,
    permit_no: v.foreign_worker ? v.permit_no.trim() : null, permit_until: v.foreign_worker ? v.permit_until || null : null,
    f8_date: v.foreign_worker ? v.f8_date || null : null, f8_institution: v.foreign_worker ? v.f8_institution.trim() || null : null,
    height: !!v.height_until, height_until: v.height_until || null };
  if (w) row.active = !!v.active;
  try {
    toast('שומר…');
    const f = n => form?.elements?.[n]?.files?.[0];
    if (f('id_photo')) row.id_photo_path = await putWorkerFile(s.id, wid, 'id', f('id_photo'));
    if (v.height_until && f('height_file')) row.height_path = await putWorkerFile(s.id, wid, 'height', f('height_file'));
    if (!v.height_until) row.height_path = null;
    if (v.foreign_worker && f('f8_file')) row.f8_path = await putWorkerFile(s.id, wid, 'f8', f('f8_file'));
    if (w) { const r = await db.update('workers', w.id, row); Object.assign(w, r); }
    else { const [r] = await db.insert('workers', { id: wid, ...row }); (S.data.workers ||= []).push(r); }
    await syncSite(s, false);
    toast(w ? 'העובד עודכן' : 'העובד נרשם');
    if (after) return after(wid);
    render();
  } catch (e) { toast(e.message.includes('under_18') ? 'השרת חסם: העובד מתחת לגיל 18' : e.message, 'bad'); }
}
const normId = (t, v) => t === 'il' ? String(v).replace(/\D/g, '').padStart(9, '0') : String(v).replace(/\s/g, '').toUpperCase();

// ===== כרטיס עובד =====
function workerCard(s, wid) {
  const w = workersOf(s.id).find(x => x.id === wid); if (!w) return;
  const st = workerStatus(w), la = lastAnnual(w), hx = heightExemption(w), canX = canExemptHeight(s.id), reg = canRegister(s.id);
  const sigs = sigsOfWorker(w.id).sort((a, b) => String(b.signed_at).localeCompare(String(a.signed_at)));
  const tr = id => (S.data.trainings || []).find(t => t.id === id);
  // תזכורת 14 יום לפני שאישור הגובה או היתר העבודה פגים (רק אם יש לעובד טלפון)
  const in14 = d => d && new Date(d) - Date.now() <= 14 * 864e5 && new Date(d) >= new Date(today());
  const remind = !w.phone || w.active === false ? [] : [
    ...(w.height && !hx && in14(w.height_until) ? [{ kind: 'height', label: 'אישור עבודה בגובה', date: fmtDate(w.height_until) }] : []),
    ...(w.foreign_worker && in14(w.permit_until) ? [{ kind: 'permit', label: 'היתר עבודה', date: fmtDate(w.permit_until) }] : [])];
  const el = h(`<div class="ov" role="dialog" aria-modal="true"><div class="dlg wide"><div class="dlg-h"><h3>${esc(w.name)}</h3><button class="x" aria-label="סגירה" data-x>✕</button></div>
    <div class="dlg-b">
      <div class="dh">${stChip(st)}${isPresent(w.id) ? '<span class="chip blue">באתר היום</span>' : ''}${w.foreign_worker ? '<span class="chip">עובד זר</span>' : ''}</div>
      ${st.issues.length && st.lv !== 'off' ? `<div class="banner ${st.lv === 'bad' ? 'crit' : ''}">${esc(st.issues.join(' · '))}</div>` : ''}
      <div class="kv">
        <span>תעודה</span><b dir="ltr" style="text-align:right">${esc(idLabel(w))}</b>
        <span>גיל</span><b>${age(w.birth_date) ?? ''} (נולד ${esc(fmtDate(w.birth_date))})</b>
        <span>חברה</span><b>${esc(w.company || '—')}</b><span>מקצוע</span><b>${esc(w.trade || '—')}</b>
        ${w.phone ? `<span>טלפון</span><b dir="ltr" style="text-align:right">${esc(w.phone)}</b>` : ''}
        <span>שפה</span><b>${esc(langLabel(w.language || 'he'))}</b>
        <span>הדרכה פרונטלית אחרונה</span><b>${la ? fmtDT(la) + ' · הבאה עד ' + fmtDate(new Date(new Date(la).getTime() + 365 * 864e5)) : '<span class="neg">לא הודרך</span>'}</b>
        <span>אישור עבודה בגובה</span><b>${hx ? `הוחרג באישור ${esc(hx.approver_name || hx.approved_by_email || '')} · ${fmtDT(hx.created_at)}<br><span class="small">${esc(hx.reason)}</span>` : w.height ? `עד ${esc(fmtDate(w.height_until))}` : '<span class="neg">אין אישור. אסור להעסיק</span>'}</b>
        <span>נוכחות</span><b>${isPresent(w.id) ? 'באתר היום' : 'לא סומן היום'} · ${daysPresent(w.id)} ימים ב-30 הימים האחרונים</b>
        ${w.foreign_worker ? `<span>אזרחות</span><b>${esc(w.nationality || '—')}</b><span>כניסה לישראל</span><b>${esc(fmtDate(w.entry_date))}</b>
          <span>היתר</span><b>${esc(w.permit_no || '')} · עד ${esc(fmtDate(w.permit_until))}</b>
          <span>הדרכת 8 שעות</span><b>${w.f8_date ? esc(fmtDate(w.f8_date) + ' · ' + (w.f8_institution || '')) : `<span class="neg">לא הוזנה. עד ${esc(fmtDate(new Date(new Date(w.entry_date).getTime() + 30 * 864e5)))}</span>`}</b>` : ''}
        <span>נרשם</span><b>${fmtDT(w.created_at)} · ${esc(w.added_by_email || '')}</b></div>
      ${remind.length ? `<div class="todo-box"><b>תזכורת לעובד</b><div class="small">${remind.map(r => `${esc(r.label)} פג ב-${esc(r.date)}`).join(' · ')}. נשלחת לעובד בוואטסאפ, בעברית ובשפה שלו.</div>
        <div class="actions">${remind.map(r => `<a class="btn small" target="_blank" rel="noopener" href="${esc(waLink(w.phone, reminderText(w.language, r.kind, { name: w.name, date: r.date, site: s.name })))}">📱 תזכורת: ${esc(r.label)}</a>`).join('')}</div></div>` : ''}
      ${w.active !== false && (reg || canX) ? `<div class="actions">${reg && !hx ? `<button type="button" class="btn" data-hcert>📷 ${w.height ? 'חידוש' : 'צירוף'} אישור עבודה בגובה</button>` : ''}
        ${canX && !hx && !w.height ? '<button type="button" class="btn ghost" data-hx>החרגה מאישור עבודה בגובה</button>' : ''}
        ${canX && hx ? '<button type="button" class="btn ghost" data-hxc>ביטול ההחרגה</button>' : ''}</div>
        ${!w.height && !hx && !canX ? `<p class="small mut">החרגה מאישור עבודה בגובה רק באישור ${esc(exemptApprover(s.id))}.</p>` : ''}` : ''}
      <div class="actions"><button type="button" class="btn small ghost" data-f="${esc(w.id_photo_path)}">צילום התעודה</button>
        ${w.height_path ? `<button type="button" class="btn small ghost" data-f="${esc(w.height_path)}">אישור עבודה בגובה</button>` : ''}
        ${w.f8_path ? `<button type="button" class="btn small ghost" data-f="${esc(w.f8_path)}">אישור הדרכת 8 שעות</button>` : ''}</div>
      <h3>הדרכות שחתם עליהן</h3>
      ${sigs.map(g => { const t = tr(g.training_id); return `<a class="wrow" href="#/site/${s.id}/workers/training/${g.training_id}" data-x2><div><b>${esc(TRAINING_KINDS[t?.kind] || '')}</b><div class="small mut">${fmtDT(g.signed_at)} · ${esc(t?.trainer_name || '')}</div><div class="small">${esc(t?.topic || '')}</div></div><span class="go">‹</span></a>`; }).join('') || '<div class="empty small">אין חתימות על הדרכה</div>'}
    </div>
    <div class="dlg-f">${canRegister(s.id) ? '<button class="btn" data-edit>עדכון פרטים ואישורים</button>' : ''}<button class="btn ghost" data-x>סגירה</button></div></div></div>`);
  document.body.appendChild(el);
  const close = () => { el.remove(); if (location.hash.split('/').length > 4) history.replaceState(null, '', `#/site/${s.id}/workers`); };
  $$('[data-x]', el).forEach(b => b.onclick = close);
  $$('[data-x2]', el).forEach(b => b.addEventListener('click', () => el.remove()));
  $$('[data-f]', el).forEach(b => b.onclick = () => openFile(b.dataset.f));
  $('[data-edit]', el)?.addEventListener('click', () => { el.remove(); workerForm(s, w); });
  $('[data-hcert]', el)?.addEventListener('click', () => { el.remove(); heightCertForm(s, w); });
  $('[data-hx]', el)?.addEventListener('click', () => { el.remove(); exemptForm(s, w, false); });
  $('[data-hxc]', el)?.addEventListener('click', () => { el.remove(); exemptForm(s, w, true); });
}

// צירוף או חידוש אישור עבודה בגובה ישר מהכרטיס (צילום בשטח)
async function heightCertForm(s, w) {
  let form = null;
  const v = await modal({ title: `אישור עבודה בגובה · ${w.name}`, ok: 'שמירה',
    body: `${fileField('צילום האישור', 'height_file', { req: true })}
      ${field('האישור בתוקף עד', 'height_until', '', { type: 'date', req: true, hint: 'תקף עד שנתיים (תקנה 6(ג) לתקנות העבודה בגובה)' })}`,
    validate: (d, f) => {
      form = f;
      if (!f.height_file.files[0]) return 'צריך לצלם את האישור';
      if (!d.height_until) return 'צריך את תאריך התוקף';
      if (d.height_until < today()) return 'האישור כבר פג. צריך אישור בתוקף';
      const max = new Date(); max.setFullYear(max.getFullYear() + 2); max.setDate(max.getDate() + 1);
      if (d.height_until > max.toISOString().slice(0, 10)) return 'אישור עבודה בגובה תקף עד שנתיים. בדקו את התאריך';
      return null;
    } });
  if (!v) return workerCard(s, w.id);
  try {
    toast('שומר…');
    const path = await putWorkerFile(s.id, w.id, 'height', form.elements.height_file.files[0]);
    const r = await db.update('workers', w.id, { height: true, height_until: v.height_until, height_path: path });
    Object.assign(w, r); await syncSite(s, false); toast('האישור נשמר'); render();
  } catch (e) { toast(e.message, 'bad'); }
}

// החרגה מאישור עבודה בגובה, או ביטול שלה. רק מנהל האתר, ובאתר בלי מנהל אתר הנהלת הקבלן הראשי או מנהל השירות
async function exemptForm(s, w, cancel) {
  if (!canExemptHeight(s.id)) return toast(`רק ${exemptApprover(s.id)} מאשר החרגה`, 'bad');
  const me = S.data.site_people.find(p => p.site_id === s.id && p.active !== false && (p.email || '').toLowerCase() === (S.user?.email || '').toLowerCase());
  const v = await modal({ title: cancel ? `ביטול החרגה · ${w.name}` : `החרגה מאישור עבודה בגובה · ${w.name}`, ok: cancel ? 'ביטול ההחרגה' : 'אישור ההחרגה',
    body: `${cancel ? '<p>אחרי הביטול העובד יסומן "אסור להעסיק" עד שמצרפים אישור עבודה בגובה בתוקף.</p>' : `<p class="small mut">כל עובד באתר צריך אישור עבודה בגובה. ההחרגה נרשמת עם שמך, הסיבה והשעה, ואי אפשר למחוק אותה. אפשר לבטל אותה בהמשך.</p>`}
      ${area(cancel ? 'סיבת הביטול' : 'למה העובד לא צריך אישור (למשל: עובד רק במפלס הקרקע)', 'reason')}
      ${field('שם המאשר', 'approver_name', me?.name?.replace(/ \(.*\)$/, '') || '', { req: true })}`,
    validate: d => (d.reason || '').trim().length < 5 ? 'צריך לכתוב סיבה' : !d.approver_name?.trim() ? 'צריך שם מאשר' : null });
  if (!v) return workerCard(s, w.id);
  try {
    const [r] = await db.insert('worker_exemptions', { site_id: s.id, worker_id: w.id, kind: 'height', cancel: !!cancel, reason: v.reason.trim(), approver_name: v.approver_name.trim(),
      approver_role: myRolesLabel(s.id), approved_by_email: S.user?.email || '', created_at: new Date().toISOString() });
    (S.data.worker_exemptions ||= []).push(r);
    await syncSite(s, false); toast(cancel ? 'ההחרגה בוטלה' : 'ההחרגה נרשמה'); render();
  } catch (e) { toast(e.message, 'bad'); }
}
const myRolesLabel = siteId => S.data.site_people.some(p => p.site_id === siteId && p.role === 'sm' && p.active !== false) ? 'sm' : hasRole(siteId, 'con') && !hasRole(siteId, 'admin') ? 'con' : 'admin';

// ===== נוכחות יומית =====
function attendanceScreen(s) {
  const day = israelDay(), can = canRegister(s.id);
  const ws = workersOf(s.id).filter(w => w.active !== false).map(w => ({ w, st: workerStatus(w), on: isPresent(w.id, day) }));
  ws.sort((a, b) => b.on - a.on || a.w.name.localeCompare(b.w.name, 'he'));
  const prev = lastAttendanceDay(s.id, day);
  const el = h(`<div>
    <a class="small" href="#/site/${s.id}/workers">→ חזרה לעובדים והדרכות</a>
    <div class="card"><h2>נוכחות היום <span class="mut small" data-cnt></span></h2>
      <p class="small mut">${new Date().toLocaleDateString('he-IL', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' })}. ${can ? 'לוחצים על כל עובד שנמצא היום באתר. ' : ''}עובד שאסור להעסיק לא יכול להיות מסומן באתר.</p>
      ${can && prev ? `<button class="btn ghost" data-same>כולם כמו ב-${esc(fmtDate(prev))}</button>` : ''}
      <div class="att">${ws.map(({ w, st, on }) => `<div class="arow" data-row="${w.id}"><div><b>${esc(w.name)}</b> ${st.lv === 'bad' || st.lv === 'warn' ? stChip(st) : ''}
          <div class="small mut">${esc([w.company, w.trade].filter(Boolean).join(' · '))}</div>
          ${st.lv === 'bad' ? `<div class="small neg">${esc(st.issues.join(' · '))}</div>` : ''}</div>
        ${can ? `<button type="button" class="btn tgl ${on ? 'on' : ''}" data-att="${w.id}" ${st.lv === 'bad' && !on ? 'disabled' : ''}>${on ? '✓ באתר' : 'לא באתר'}</button>` : `<span class="chip ${on ? 'green' : ''}">${on ? 'באתר' : 'לא סומן'}</span>`}</div>`).join('') || '<div class="empty">אין עובדים פעילים. רושמים עובדים בלשונית העובדים.</div>'}</div></div></div>`);
  const count = () => { $('[data-cnt]', el).textContent = `${ws.filter(x => isPresent(x.w.id, day)).length} באתר מתוך ${ws.length}`; };
  const paint = (b, on) => { b.classList.toggle('on', on); b.textContent = on ? '✓ באתר' : 'לא באתר'; };
  count();
  $$('[data-att]', el).forEach(b => b.onclick = async () => {
    const x = ws.find(q => q.w.id === b.dataset.att), on = !isPresent(x.w.id, day);
    if (on && x.st.lv === 'bad') return toast('אסור להעסיק את העובד: ' + x.st.issues[0], 'bad');
    b.disabled = true;
    try { await markAttendance(s, x.w, on, day); paint(b, on); count(); } catch (e) { toast(e.message.includes('attendance_day') ? 'אפשר לסמן נוכחות רק להיום' : e.message, 'bad'); }
    b.disabled = !on && x.st.lv === 'bad';
  });
  $('[data-same]', el)?.addEventListener('click', async e => {
    e.target.disabled = true;
    const was = new Set(attendanceOf(s.id, prev).filter(a => a.present).map(a => a.worker_id));
    let n = 0, skip = 0;
    for (const x of ws) {
      if (!was.has(x.w.id) || isPresent(x.w.id, day)) continue;
      if (x.st.lv === 'bad') { skip++; continue; }
      try { await markAttendance(s, x.w, true, day); n++; const b = $(`[data-att="${x.w.id}"]`, el); if (b) paint(b, true); } catch (er) { toast(er.message, 'bad'); break; }
    }
    count(); e.target.disabled = false;
    toast(`סומנו ${n} עובדים${skip ? `. ${skip} לא סומנו כי אסור להעסיק אותם` : ''}`, skip ? 'bad' : 'ok');
  });
  return el;
}
export async function markAttendance(s, w, present, day = israelDay()) {
  const cur = (S.data.attendance || []).find(a => a.worker_id === w.id && a.day === day);
  if (cur) { const r = await db.update('attendance', cur.id, { present }); Object.assign(cur, r); return cur; }
  const [r] = await db.insert('attendance', { site_id: s.id, worker_id: w.id, day, present, marked_by_email: S.user?.email || '', marked_at: new Date().toISOString() });
  (S.data.attendance ||= []).push(r); return r;
}

// ===== הדרכה =====
const TOPIC = {
  intro: 'הדרכת אתר לעובד חדש: הסיכונים באתר ואמצעי הבטיחות, ציוד מגן אישי, עבודה בגובה ופתחים, מכונות וחשמל, עזרה ראשונה ויציאות חירום',
  annual: 'הדרכת בטיחות שנתית: הסיכונים בעבודה ובאתר, הוראות הבטיחות, ציוד מגן אישי, דיווח על מפגעים',
  height: 'עבודה בגובה באתר: רתמה וקו חיים, פיגומים, סולמות, גידור ופתחים',
  toolbox: '', other: ''
};
export async function newTraining(s) {
  const me = S.data.site_people.find(p => p.site_id === s.id && p.active !== false && (p.email || '').toLowerCase() === (S.user?.email || '').toLowerCase() && ['wm', 'rep', 'so'].includes(p.role))
    || S.data.site_people.find(p => p.site_id === s.id && p.active !== false && ['wm', 'rep'].includes(p.role) && !p.backup);
  const v = await modal({ title: 'הדרכה חדשה', ok: 'פתיחה והחתמת עובדים',
    body: `${select('סוג ההדרכה', 'kind', TRAINING_KINDS, 'intro')}
      ${area('נושא ותוכן ההדרכה', 'topic', TOPIC.intro)}
      <div class="grid g2">${field('שם המדריך', 'trainer_name', me?.name?.replace(/ \(.*\)$/, '') || '', { req: true })}${field('תפקיד וכשירות המדריך', 'trainer_title', me ? ({ rep: 'נציג מבצע הבנייה', so: 'ממונה בטיחות' }[me.role] || 'מנהל עבודה') + (me.license ? ', ' + me.license : '') : '')}</div>
      ${select('שפת ההדרכה', 'language', Object.fromEntries(Object.values(LANGS).map(v => [v.he, v.he])), 'עברית')}
      <p class="small mut">ההדרכה באתר בנייה פנים אל פנים, בשפה שהעובד מבין, בידי בעל מקצוע מתאים. אחרי הפתיחה כל עובד חותם בטלפון של המדריך, או בטלפון שלו דרך קישור אישי ב-WhatsApp (בלי שם משתמש וסיסמה). ה-PDF נשמר לבד אחרי כל חתימה.</p>`,
    onMount: el => $('[name=kind]', el).addEventListener('change', e => { const t = $('[name=topic]', el); if (!t.value.trim() || Object.values(TOPIC).includes(t.value)) t.value = TOPIC[e.target.value] || ''; }),
    validate: d => !d.topic?.trim() ? 'צריך נושא' : !d.trainer_name?.trim() ? 'צריך שם מדריך' : null });
  if (!v) return;
  try {
    const [t] = await db.insert('trainings', { site_id: s.id, kind: v.kind, topic: v.topic.trim(), trainer_name: v.trainer_name.trim(), trainer_title: v.trainer_title.trim(),
      language: v.language.trim(), content: '', held_at: new Date().toISOString() });
    (S.data.trainings ||= []).push(t);
    location.hash = `#/site/${s.id}/workers/training/${t.id}`;
  } catch (e) { toast(e.message, 'bad'); }
}

function trainingScreen(s, tid) {
  const t = (S.data.trainings || []).find(x => x.id === tid && x.site_id === s.id);
  if (!t) return h('<div class="card empty">ההדרכה לא נמצאה</div>');
  const sigs = sigsOfTraining(t.id), signed = new Map(sigs.map(g => [g.worker_id, g]));
  const can = canRegister(s.id) && !t.closed_at;
  const list = workersOf(s.id).filter(w => w.active !== false || signed.has(w.id));
  list.sort((a, b) => signed.has(a.id) - signed.has(b.id) || a.name.localeCompare(b.name, 'he'));
  const el = h(`<div>
    <a class="small" href="#/site/${s.id}/workers">→ חזרה לעובדים והדרכות</a>
    <div class="card"><h2>${esc(TRAINING_KINDS[t.kind])} ${t.closed_at ? '<span class="chip green">הסתיימה</span>' : '<span class="chip amber">פתוחה לחתימות</span>'}</h2>
      <p>${esc(t.topic)}</p>
      <div class="kv small"><span>מועד</span><b>${fmtDT(t.held_at)}</b><span>מדריך</span><b>${esc(t.trainer_name)}${t.trainer_title ? ' · ' + esc(t.trainer_title) : ''}</b><span>שפה</span><b>${esc(t.language || '')}</b>
        <span>חתמו</span><b>${sigs.length}</b>
        <span>PDF</span><b>${t.pdf_path ? `נשמר ${fmtDT(t.pdf_at || t.created_at)} · <button type="button" class="btn link" data-pdf>פתיחה</button>` : sigs.length ? '<span class="mut">יישמר בחתימה הבאה</span>' : '<span class="mut">נשמר לבד אחרי החתימה הראשונה</span>'}</b></div>
      ${t.trainer_sig ? `<div class="small mut">חתימת המדריך:</div><img src="${t.trainer_sig}" alt="חתימת המדריך" class="sigimg">` : ''}</div>
    <div class="card"><div class="dh"><h2>עובדים</h2>${can ? '<button class="btn small ghost" data-neww>＋ עובד חדש</button>' : ''}</div>
      ${list.map(w => { const g = signed.get(w.id), st = workerStatus(w); return `<div class="wrow ${g ? 'lv-ok' : ''}"><div><b>${esc(w.name)}</b>${g ? '' : ' ' + stChip(st)}<div class="small mut">${esc([w.company, w.trade].filter(Boolean).join(' · '))}</div>
        ${g ? `<div class="small ok-t">✓ חתם ${fmtDT(g.signed_at)}</div>` : ''}
        ${g && g.signed_by_email === VIA_LINK ? '<div class="small mut">נחתם בטלפון של העובד</div>' : ''}${!g && pendLink(t.id, w.id) ? `<div class="small mut">📱 נשלח קישור לטלפון · בתוקף עד ${fmtDT(pendLink(t.id, w.id).expires_at)}</div>` : ''}</div>
        ${g ? (g.image ? `<img src="${g.image}" alt="חתימה" class="sigthumb">` : '') : can ? `<div class="actions"><button class="btn" data-wsign="${w.id}">חתימה כאן</button><button class="btn ghost" data-wlink="${w.id}" title="העובד חותם בטלפון שלו, בלי שם משתמש וסיסמה">📱 קישור לטלפון שלו</button></div>` : ''}</div>`; }).join('') || '<div class="empty">אין עובדים רשומים. מוסיפים עובד חדש, ואז הוא חותם.</div>'}</div>
    ${can ? `<div class="card"><button class="btn ghost" data-close ${sigs.length ? '' : 'disabled'}>סיום ההדרכה וחתימת המדריך</button><p class="small mut">אחרי הסיום אי אפשר להוסיף חתימות. ה-PDF הסופי נשמר עם חתימת המדריך.</p></div>` : ''}
  </div>`);
  $('[data-pdf]', el)?.addEventListener('click', () => openFile(t.pdf_path));
  $('[data-neww]', el)?.addEventListener('click', () => workerForm(s, null, { after: wid => { render(); setTimeout(() => signWorker(s, t, wid), 300); } }));
  $$('[data-wsign]', el).forEach(b => b.onclick = () => signWorker(s, t, b.dataset.wsign));
  $$('[data-wlink]', el).forEach(b => b.onclick = () => sendSignLink(s, t, workersOf(s.id).find(w => w.id === b.dataset.wlink)));
  el.addEventListener('mounted', () => {
    // חתימות שהגיעו מהטלפונים של העובדים: ה-PDF מתעדכן, והמסך בודק כל 20 שניות כל עוד יש קישורים פתוחים
    const last = sigs.reduce((m, g) => String(g.signed_at) > m ? String(g.signed_at) : m, '');
    if (can && sigs.length && (!t.pdf_at || last > String(t.pdf_at))) savePdf(s, t).catch(x => console.warn('pdf', x));
    if (!can || !list.some(w => !signed.has(w.id) && pendLink(t.id, w.id))) return;
    const iv = setInterval(async () => {
      if (!el.isConnected) return clearInterval(iv);
      if (document.querySelector('.ov')) return;
      try {
        const fresh = await db.select('training_signatures', { eq: { training_id: t.id } });
        if (fresh.length > sigs.length) {
          clearInterval(iv);
          const have = new Set((S.data.training_signatures || []).map(g => g.id));
          (S.data.training_signatures ||= []).push(...fresh.filter(g => !have.has(g.id)));
          toast('התקבלה חתימה מהטלפון של עובד');
          if (COUNTS_ANNUAL.includes(t.kind)) await syncSite(s, false);
          render();
        }
      } catch (e) { console.warn(e); }
    }, 20e3);
  });
  $('[data-close]', el)?.addEventListener('click', () => closeTraining(s, t));
  return el;
}

// ===== חתימה בטלפון של העובד: קישור אישי, בלי שם משתמש וסיסמה =====
const VIA_LINK = 'קישור אישי בטלפון העובד';
const pendLink = (tid, wid) => (S.data.share_links || []).filter(l => l.kind === 'training' && l.training_id === tid && l.worker_id === wid && !l.revoked_at && !l.used_at && new Date(l.expires_at) > Date.now()).pop();
async function sendSignLink(s, t, w) {
  if (!w) return;
  if (age(w.birth_date) < 18) return toast('אסור להעסיק עובד מתחת לגיל 18', 'bad');
  const win = w.phone ? window.open('', '_blank') : null;
  try {
    const r = await db.rpc('share_link_create', { p_kind: 'training', p_site: s.id, p_hours: 48, p_label: null, p_training: t.id, p_worker: w.id, p_payload: null });
    S.data.share_links = await db.select('share_links', { order: 'created_at' }).catch(() => S.data.share_links);
    const url = `${appUrl()}#/t/${r.token}`, until = fmtDT(r.expires_at);
    const x = { name: w.name, kind: TRAINING_KINDS[t.kind], site: s.name, until };
    const lang = w.language && w.language !== 'he' && LINK_MSG[w.language] ? w.language : null;
    const text = [LINK_MSG.he(x), lang ? LINK_MSG[lang](x) : '', url].filter(Boolean).join('\n\n');
    if (win) { win.location.href = waLink(w.phone, text); toast('נפתח WhatsApp עם הקישור'); }
    else {
      try { await navigator.clipboard.writeText(text); } catch { /* אין גישה ללוח */ }
      await modal({ title: 'קישור לחתימה בטלפון של ' + w.name, ok: null, cancel: 'סגירה',
        body: `<p class="small">לעובד לא רשום טלפון. ההודעה הועתקה, ואפשר לשלוח אותה בכל דרך:</p><input class="linkbox" dir="ltr" readonly value="${esc(url)}">
          <div class="actions"><a class="btn wa" href="${esc(waShare(text))}" target="_blank" rel="noopener">שליחה ב-WhatsApp</a></div>` });
    }
    render();
  } catch (e) { win?.close?.(); toast(e.message, 'bad'); }
}

const statement = (s, t, w) => `אני, ${w.name}, ${w.id_type === 'passport' ? 'דרכון' : 'ת"ז'} ${w.id_number}, מאשר/ת שהיום, ${new Date().toLocaleDateString('he-IL')}, קיבלתי ${TRAINING_KINDS[t.kind]} באתר ${s.name}, בנושא: ${t.topic}. ההדרכה ניתנה פנים אל פנים בידי ${t.trainer_name}, בשפה שאני מבין/ה (${t.language || '—'}), והבנתי אותה.`;

// מסך חתימה מלא: העובד קורא, חותם באצבע ומאשר
function signWorker(s, t, wid) {
  const w = workersOf(s.id).find(x => x.id === wid); if (!w) return;
  const st = workerStatus(w);
  if (age(w.birth_date) < 18) return toast('אסור להעסיק עובד מתחת לגיל 18', 'bad');
  const text = statement(s, t, w);
  const lang = w.language && w.language !== 'he' && LANGS[w.language] ? w.language : null;
  const local = lang ? localStatement(lang, { name: w.name, idType: w.id_type, id: w.id_number, kind: t.kind, site: s.name, trainer: t.trainer_name, trainingLang: t.language }) : null;
  const el = h(`<div class="ov full" role="dialog" aria-modal="true"><div class="dlg signdlg"><div class="dlg-h"><h3>חתימה על קבלת הדרכה</h3><button class="x" aria-label="סגירה" data-x>✕</button></div>
    <div class="dlg-b"><div class="signname">${esc(w.name)}</div>
      ${st.lv === 'bad' && !st.issues.every(x => /לא הודרך|הדרכה שנתית/.test(x)) ? `<div class="banner crit">${esc(st.issues.join(' · '))}</div>` : ''}
      ${langCode(t.language) && langCode(t.language) !== (w.language || 'he') ? `<div class="banner">ההדרכה ניתנה ב${esc(t.language)}, והעובד מבין ${esc(langLabel(w.language || 'he'))}. מחתימים רק אם ההדרכה הוסברה לו בשפה שלו (למשל בעזרת מתורגמן).</div>` : ''}
      ${local ? `<p class="signtext local" dir="${LANGS[lang].dir}" lang="${lang}">${esc(local)}</p><div class="small mut">הנוסח בעברית:</div>` : ''}
      <p class="signtext">${esc(text)}</p>
      <canvas class="sgpad tall" aria-label="משטח חתימה"></canvas>
      <div class="actions"><button type="button" class="btn ghost" data-clear>ניקוי ${lang ? '· ' + esc(SIGN_HERE[lang]) : ''}</button><button type="button" class="btn big" data-ok>אישור וחתימה${lang ? ' · ' + esc(OK_BTN[lang]) : ''}</button></div></div></div></div>`);
  document.body.appendChild(el);
  const p = pad($('canvas', el));
  const close = () => el.remove();
  $$('[data-x]', el).forEach(b => b.onclick = close);
  $('[data-clear]', el).onclick = p.clear;
  $('[data-ok]', el).onclick = async e => {
    if (p.empty()) return toast('צריך לחתום במשטח', 'bad');
    e.target.disabled = true;
    try {
      const [g] = await db.insert('training_signatures', { training_id: t.id, site_id: s.id, worker_id: w.id, worker_name: w.name, statement: text, image: p.png(),
        ...(local ? { statement_local: local, lang } : {}), client_signed_at: new Date().toISOString(),
        user_agent: navigator.userAgent.slice(0, 300), signed_by_email: S.user?.email || '', signed_at: new Date().toISOString() });
      (S.data.training_signatures ||= []).push(g);
      close(); toast(`${w.name} חתם`);
      if (COUNTS_ANNUAL.includes(t.kind)) await syncSite(s, false);
      render();
      savePdf(s, t).catch(x => toast('החתימה נשמרה, אבל שמירת ה-PDF נכשלה: ' + x.message, 'bad'));
    } catch (x) { e.target.disabled = false; toast(x.message, 'bad'); }
  };
}

async function closeTraining(s, t) {
  const el = h(`<div class="ov full" role="dialog" aria-modal="true"><div class="dlg signdlg"><div class="dlg-h"><h3>סיום ההדרכה</h3><button class="x" aria-label="סגירה" data-x>✕</button></div>
    <div class="dlg-b"><p>אני, ${esc(t.trainer_name)}, מצהיר/ה שהעברתי את ההדרכה פנים אל פנים, בשפה שהעובדים מבינים, לעובדים שחתמו (${sigsOfTraining(t.id).length}).</p>
      <canvas class="sgpad tall" aria-label="חתימת המדריך"></canvas>
      <div class="actions"><button type="button" class="btn ghost" data-clear>ניקוי</button><button type="button" class="btn big" data-ok>סיום וחתימה</button></div></div></div></div>`);
  document.body.appendChild(el);
  const p = pad($('canvas', el));
  $$('[data-x]', el).forEach(b => b.onclick = () => el.remove());
  $('[data-clear]', el).onclick = p.clear;
  $('[data-ok]', el).onclick = async e => {
    if (p.empty()) return toast('צריך חתימת מדריך', 'bad');
    e.target.disabled = true;
    try {
      const r = await db.update('trainings', t.id, { trainer_sig: p.png(), closed_at: new Date().toISOString() });
      Object.assign(t, r); el.remove(); toast('ההדרכה הסתיימה');
      await savePdf(s, t).catch(x => toast('שמירת ה-PDF נכשלה: ' + x.message, 'bad'));
      render();
    } catch (x) { e.target.disabled = false; toast(x.message, 'bad'); }
  };
}

// ===== PDF אוטומטי: נשמר אחרי כל חתימה ובסיום =====
export async function trainingPdf(s, t, sigs, at, hash) {
  const ws = new Map(workersOf(s.id).map(w => [w.id, w]));
  const con = S.data.site_orgs.filter(x => x.site_id === s.id && x.kind === 'contractor').map(x => S.data.orgs.find(o => o.id === x.org_id)?.name).filter(Boolean).join(', ');
  const imgs = await Promise.all(sigs.map(g => loadImg(g.image)));
  const blocks = [
    { type: 'title', text: 'רישום הדרכת בטיחות לעובדים', brand: 'צי הנדסה', sub: 'לפי תקנות 3 ו-6 לתקנות ארגון הפיקוח על העבודה (מסירת מידע והדרכת עובדים), התשנ"ט-1999' },
    { type: 'kv', rows: [['האתר', s.name + (s.address ? ', ' + s.address : '')], ['מבצע הבנייה', con || '—'], ['סוג ההדרכה', TRAINING_KINDS[t.kind]], ['נושא ותוכן', t.topic],
      ['מועד', fmtDT(t.held_at)], ['המדריך', t.trainer_name + (t.trainer_title ? ', ' + t.trainer_title : '')], ['שפת ההדרכה', t.language || '—']] },
    { type: 'table', cols: [{ h: '#', w: 0.05 }, { h: 'שם העובד', w: 0.2 }, { h: 'תעודה', w: 0.16 }, { h: 'חברה · מקצוע', w: 0.21 }, { h: 'חתימה', w: 0.2 }, { h: 'מועד החתימה', w: 0.18 }],
      rows: sigs.map((g, i) => { const w = ws.get(g.worker_id) || {}; return [String(i + 1), g.worker_name, w.id_number ? (w.id_type === 'passport' ? 'דרכון ' : 'ת"ז ') + w.id_number : '',
        [w.company, w.trade].filter(Boolean).join(' · '), imgs[i] ? { img: imgs[i] } : '', sigTime(g)]; }) },
    ...sigs.filter(g => g.statement_local).flatMap(g => [{ type: 'p', text: `${g.worker_name}: הנוסח שעליו חתם בשפתו (${langLabel(g.lang)})`, bold: true, size: 18, color: '#111' },
      { type: 'p', text: g.statement_local, size: 18, dir: LANGS[g.lang]?.dir === 'ltr' ? 'ltr' : 'rtl' }]),
    { type: 'p', text: 'מועד החתימה לפי שעון השרת. חתימה שנעשתה בלי קליטה מציגה גם את שעת הטלפון. כל עובד אישר בחתימתו שקיבל את ההדרכה פנים אל פנים, בשפה שהוא מבין, ושהבין אותה. נוסח האישור המלא של כל עובד שמור במערכת.', size: 18 }
  ];
  if (t.trainer_sig) blocks.push({ type: 'p', text: `הצהרת המדריך: העברתי את ההדרכה פנים אל פנים, בשפה שהעובדים מבינים. ${t.trainer_name}`, bold: true, size: 20, color: '#111' }, { type: 'sig', img: await loadImg(t.trainer_sig) });
  else blocks.push({ type: 'p', text: 'ההדרכה עוד פתוחה. המסמך מתעדכן לבד עם כל חתימה, ובסיום עם חתימת המדריך.', bold: true, color: '#b00020' });
  blocks.push({ type: 'p', size: 16, color: '#666', text: `הופק אוטומטית ${fmtDT(at)} ממערכת ניהול הבטיחות של צי הנדסה. החתימות נשמרו במערכת עם שעת השרת והמשתמש שהחזיק את הטלפון, ואינן ניתנות לעריכה או למחיקה. יש לצרף עותק לפנקס ההדרכה.` },
    { type: 'p', size: 15, color: '#666', text: 'טביעת אצבע (SHA-256) של רשימת החתימות: ' + hash });
  return pagesToPdf(await renderPdfPages(blocks, `${s.name} · ${TRAINING_KINDS[t.kind]} · ${fmtDT(t.held_at)}`));
}
// שעת החתימה: לפי השרת. אם נחתם בלי קליטה ונשלח מאוחר, מציגים גם את שעת הטלפון
const sigTime = g => g.client_signed_at && g.signed_at && Math.abs(new Date(g.signed_at) - new Date(g.client_signed_at)) > 5 * 6e4
  ? `${fmtDT(g.client_signed_at)} (בלי קליטה. התקבל ${fmtDT(g.signed_at)})` : fmtDT(g.signed_at || g.client_signed_at);
async function savePdf(s, t) {
  const sigs = sigsOfTraining(t.id);
  if (!sigs.length) return;
  const at = new Date().toISOString();
  const hash = await sha256Hex(JSON.stringify(sigs.map(g => [g.id, g.worker_id, g.signed_at, g.statement, (g.image || '').length])));
  const blob = await trainingPdf(s, t, sigs, at, hash);
  const path = `${s.id}/workers/trainings/${t.id}/${at.replace(/[:.]/g, '-')}-${sigs.length}${t.closed_at ? '-final' : ''}.pdf`;
  await db.putFile(path, new File([blob], 'training.pdf', { type: 'application/pdf' }));
  const r = await db.update('trainings', t.id, { pdf_path: path });
  Object.assign(t, r, { pdf_at: r.pdf_at || at });
  toast('ה-PDF נשמר');
  if (location.hash.includes(t.id)) render();
}
