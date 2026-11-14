// תוכנית ארגון בטיחות לאתר (תקנה 166 והתוספת השלישית) ונספח משאבים ליישום התוכנית (תקנה 1א(א)(2))
// טיוטה נערכת חופשי. מבצע הבנייה חותם על התוכנית; על נספח המשאבים חותמים היזם ומבצע הבנייה.
// מהחתימה הראשונה הנוסח ננעל בשרת. שינוי אחרי חתימה = גרסה חדשה.
import { db, uuid } from '../db.js';
import { S, hasRole, render, syncSite, conNames, siteOrgs } from '../app.js';
import { derive, ROLES, WORK_TYPES } from '../duties.js';
import { esc, h, $, $$, toast, modal, fmtDate } from '../util.js';
import { workersOf, equipmentOf, EQUIP_KINDS, renderPdfPages, pagesToPdf, sha256Hex, loadImg } from '../workers.js';
import { pad } from './sign.js';
import { fmtDT, openFile } from './common.js';

export const PLAN_REF = 'תקנה 166 והתוספת השלישית לתקנות הבטיחות בעבודה (עבודות בנייה), התשמ"ח-1988';
const RES_REF = 'תקנה 1א(א)(2) לתקנות הבטיחות בעבודה (עבודות בנייה), התשמ"ח-1988';
export const canEditPlan = (siteId, kind) => kind === 'plan' ? hasRole(siteId, 'con', 'so', 'sm', 'wm', 'rep') : hasRole(siteId, 'dev', 'con', 'so');
const SLOTS = { plan: [['con', 'מבצע הבנייה']], resources: [['dev', 'היזם (המזמין)'], ['con', 'מבצע הבנייה']] };
const canSlot = (siteId, slot) => hasRole(siteId, slot);
const ROLE_ORDER = ['con', 'sm', 'wm', 'rep', 'so', 'bakar', 'fa'];

// ===== מבנה התוכנית לפי התוספת השלישית =====
const RISK_COLS = [['risk', 'הסיכון', 0.2], ['level', 'הערכת הסיכון', 0.1], ['measures', 'אמצעי הבקרה שנבחרו', 0.26], ['approver', 'מאשר רמת סיכון קביל', 0.12], ['responsible', 'אחראי ליישום', 0.12], ['due', 'מועד יישום', 0.09], ['follow', 'מעקב', 0.11]];
const PROC_COLS = [['name', 'הוראה או נוהל', 0.7], ['updated', 'עדכון אחרון', 0.3]];
export const PARTS = [
  { k: 'a', t: "פרק א': תיאור אתר הבנייה", f: [
    ['purpose', 'מטרת העבודה באתר'], ['activities', 'הפעילויות העיקריות שמבוצעות באתר'], ['workers_max', 'מספר העובדים (בו-זמנית, לכל היותר)', 'text'],
    ['trades', 'סוגי העובדים ומקצועותיהם'], ['facilities', 'מיקום המיתקנים באתר (משרד, מחסנים, עגורן, אזורי אחסון, כניסות)']] },
  { k: 'b', t: "פרק ב': מדיניות הבטיחות והבריאות התעסוקתית", f: [
    ['goals', 'יעדים'], ['measures', 'אמצעים להשגת היעדים'], ['priorities', 'סדרי עדיפויות'], ['standards', 'תקנים והנחיות שמבצע הבנייה מחויב להם'],
    ['resources', 'משאבים: לפי פרקי התוכנית ולפי כל סיכון (מפורטים בנספח המשאבים)'], ['acceptable', 'הגדרת רמת הסיכון הקביל']] },
  { k: 'c', t: "פרק ג': ארגון הבטיחות באתר", f: [
    ['structure', 'מבנה ארגון הבטיחות (מי מדווח למי)'], ['roles', 'בעלי התפקידים (מתמלא מרשימת בעלי התפקידים בעת החתימה)', 'auto'],
    ['emergency', 'ארגון ותגובה לשעת חירום (מי מפעיל, טלפונים, נקודת כינוס, פינוי)'], ['firstaid', 'האחראי על ארגז העזרה הראשונה, ומגישי העזרה הראשונה']] },
  { k: 'd', t: "פרק ד': ניהול סיכונים באתר", f: [
    ['risks', 'ניתוח הסיכונים: זיהוי, הערכה, אמצעי בקרה, מי מאשר ומי אחראי, לוח זמנים ומעקב', 'risks'],
    ['proc_hazards', 'נוהל איתור מפגעי בטיחות ותוכנית שנתית לסילוקם'], ['proc_new', 'נוהל אישור ובקרה של גורמי סיכון חדשים לאתר'], ['proc_accidents', 'נוהל הודעות על תאונות'],
    ['annual', 'תוכנית שנתית: סקרי סיכונים, ביקורות ומבדקים, פעולות מתקנות והפקת לקחים']] },
  { k: 'e', t: "פרק ה': הדרכות בטיחות ובריאות תעסוקתית", f: [
    ['proc', 'נוהל הדרכות: לעובדים חדשים ולמועסקים באתר שאינם עובדי מבצע הבנייה (כולל עובדי קבלנים)'],
    ['annual', 'תוכנית שנתית להדרכות: מסירת מידע על הסיכונים, שמירת כשירות בעלי התפקידים, תרגול חירום, הגברת המודעות']] },
  { k: 'f', t: "פרק ו': בדיקות תקופתיות לציוד ולחומרים", f: [
    ['items', 'פריטים החייבים בבדיקות תקופתיות: הבדיקה, המועד ודרך המעקב'], ['emergency', 'תוכנית שנתית לבדיקת אמצעי הבטיחות והחירום באתר']] },
  { k: 'g', t: "פרק ז': היתרים, אישורים, רישיונות, הסמכות, מינויים וכשירויות", f: [
    ['permits', 'תוכנית לקבלה ולחידוש של ההיתרים והאישורים הנדרשים לאתר'], ['roles', 'בעלי תפקידים שנדרש להם רישיון, הסמכה או מינוי: מועד החידוש ודרך המעקב'],
    ['workers', 'עובדים שנדרשת להם הרשאה או כשירות (למשל עבודה בגובה): מועד החידוש ודרך המעקב']] },
  { k: 'h', t: "פרק ח': הוראות ונוהלי הבטיחות של מבצע הבנייה", f: [
    ['procs', 'רשימת ההוראות והנהלים, כולל היערכות ותגובה למצבי חירום, עם מועד העדכון האחרון', 'procs']] }
];
const RES_COLS = [['chapter', 'פרק בתוכנית', 0.18], ['risk', 'סיכון / נושא', 0.18], ['resource', 'המשאב (כוח אדם, ציוד, שירות)', 0.28], ['amount', 'היקף / סכום', 0.12], ['provider', 'מי מספק', 0.12], ['timing', 'מתי', 0.12]];

const plansOf = (siteId, kind) => (S.data.safety_plans || []).filter(p => p.site_id === siteId && p.kind === kind).sort((a, b) => b.version - a.version);
const sigsOf = p => (S.data.signatures || []).filter(g => g.doc_ref === p.id && g.doc_type === (p.kind === 'plan' ? 'safety_plan' : 'safety_resources'));
const curSigs = p => { const o = {}; for (const g of sigsOf(p).filter(g => !p.locked_hash || g.doc_hash === p.locked_hash)) o[g.slot] = g; return o; };
export const planDone = p => !!p && SLOTS[p.kind].every(([k]) => curSigs(p)[k]);
const people = s => S.data.site_people.filter(p => p.site_id === s.id && p.active !== false).sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role));
const rolesText = s => people(s).filter(p => ROLE_ORDER.includes(p.role)).map(p => `${ROLES[p.role]}${p.backup ? ' (ממלא מקום)' : ''}: ${p.name}${p.phone ? ', ' + p.phone : ''}${p.license ? ', ' + p.license : ''}`).join('\n');

// ===== טיוטה ראשונה: מה שהמערכת כבר יודעת על האתר, ונוסח התחלתי לעריכה =====
function prefill(s) {
  const pr = s.profile || {};
  const trades = [...new Set(workersOf(s.id).map(w => w.trade).filter(Boolean))].join(', ');
  const eq = equipmentOf(s.id).filter(e => e.active !== false);
  const fa = people(s).filter(p => p.role === 'fa').map(p => p.name).join(', ');
  const lic = people(s).filter(p => ['wm', 'sm', 'so', 'bakar'].includes(p.role)).map(p => `${ROLES[p.role]}: ${p.name}${p.license ? ' (' + p.license + ')' : ''}. מעקב: רשימת בעלי התפקידים במערכת.`).join('\n');
  const R = (risk, measures = '') => ({ risk, level: '', measures, approver: 'מבצע הבנייה', responsible: 'מנהל העבודה', due: 'לפני תחילת העבודה ולאורכה', follow: 'צ׳ק-אין יומי וביקורות באתר' });
  return {
    a: { purpose: [WORK_TYPES[pr.work_type], s.address].filter(Boolean).join(', '), activities: '', workers_max: pr.workers ? String(pr.workers) : '', trades, facilities: '' },
    b: { goals: 'אפס תאונות עבודה. עמידה בכל חובות הבטיחות באתר. תיקון כל ליקוי בטיחות עד המועד שנקבע לו.', measures: '', priorities: 'סיכון מיידי לחיים קודם לכל עבודה אחרת. עבודה בגובה, הרמת משאות וחשמל קודמים לשאר הסיכונים.', standards: '', resources: 'מפורטים בנספח המשאבים, לפי פרקי התוכנית ולפי כל סיכון.', acceptable: '' },
    c: { structure: 'מבצע הבנייה ← מנהל העבודה ← ראשי צוותים וקבלני משנה. הממונה על הבטיחות ובקר הבטיחות מייעצים ומבקרים.', emergency: '', firstaid: fa ? 'מגישי עזרה ראשונה: ' + fa : '' },
    d: { risks: [R('נפילה מגובה ופתחים'), R('נפילת חפצים ועבודה מתחת למשא'), R('מכונות הרמה והרמת משאות'), R('חשמל'), R('פיגומים'), R('עבודות חמות ואש'), R('תנועת כלים ורכבים באתר')],
      proc_hazards: 'כל ליקוי בטיחות מתועד במערכת הבטיחות עם צילום, אחראי ומועד תיקון, ונסגר רק עם צילום אחרי התיקון.', proc_new: '', proc_accidents: 'תאונה מדווחת מיד למנהל העבודה ולמבצע הבנייה, מתועדת במערכת (צילומים ועדים), ונמסרת עליה הודעה כנדרש בדין.', annual: '' },
    e: { proc: 'כל עובד, גם עובד של קבלן משנה, מקבל הדרכה לפני תחילת העבודה, פנים אל פנים ובשפה שהוא מבין, וחותם עליה במערכת.', annual: 'הדרכה שנתית לכל עובד. תדריך בטיחות בתחילת עבודה מסוכנת. תרגול חירום.' },
    f: { items: eq.map(e => `${e.name}${e.ident ? ' ' + e.ident : ''} (${EQUIP_KINDS[e.kind]?.label || e.kind}): תסקיר בודק מוסמך בתוקף ובדיקה יומית לפני הפעלה. מעקב: לשונית הציוד במערכת.`).join('\n'), emergency: '' },
    g: { permits: '', roles: lic, workers: 'עבודה בגובה: אישור בתוקף לכל עובד שעובד בגובה. עובד זר: היתר עבודה בתוקף. מעקב: פנקס העובדים במערכת, עם התראה לפני שאישור פג.' },
    h: { procs: [{ name: 'נוהל חירום ופינוי', updated: '' }, { name: 'נוהל עבודה בגובה', updated: '' }, { name: 'נוהל הרמת משאות', updated: '' }] }
  };
}
function resPrefill(s) {
  const plan = plansOf(s.id, 'plan')[0];
  const risks = plan?.data?.d?.risks || [];
  return { rows: risks.length ? risks.map(r => ({ chapter: "פרק ד': ניהול סיכונים", risk: r.risk, resource: '', amount: '', provider: 'מבצע הבנייה', timing: '' }))
    : [{ chapter: "פרק ד': ניהול סיכונים", risk: '', resource: '', amount: '', provider: 'מבצע הבנייה', timing: '' }], note: '' };
}

// ===== הנוסח שעליו חותמים (טקסט אחד, טביעת אצבע SHA-256) =====
export function planText(s, p) {
  const d = p.data || {}, L = [];
  if (p.kind === 'plan') {
    L.push(`תוכנית ארגון בטיחות לאתר · ${s.name}${s.address ? ', ' + s.address : ''} · גרסה ${p.version}`, `לפי ${PLAN_REF}`, `מבצע הבנייה: ${conNames(s.id).join(', ') || '—'}`);
    for (const part of PARTS) {
      L.push('', part.t);
      for (const [k, label, type] of part.f) {
        const v = (d[part.k] || {})[k];
        if (type === 'risks') (v || []).forEach((r, i) => L.push(`${i + 1}. ${RISK_COLS.map(([c, l]) => `${l}: ${r[c] || '—'}`).join(' | ')}`));
        else if (type === 'procs') (v || []).forEach((r, i) => L.push(`${i + 1}. ${r.name}${r.updated ? ' (עודכן ' + r.updated + ')' : ''}`));
        else L.push(`${label}: ${v || '—'}`);
      }
    }
  } else {
    L.push(`נספח משאבים ליישום תוכנית הבטיחות · ${s.name}${s.address ? ', ' + s.address : ''} · גרסה ${p.version}`, `לפי ${RES_REF}`,
      `היזם: ${siteOrgs(s.id, 'developer').map(o => o.name).join(', ') || '—'} · מבצע הבנייה: ${conNames(s.id).join(', ') || '—'}`);
    (d.rows || []).forEach((r, i) => L.push(`${i + 1}. ${RES_COLS.map(([c, l]) => `${l}: ${r[c] || '—'}`).join(' | ')}`));
    if (d.note) L.push('', 'הערות: ' + d.note);
  }
  return L.join('\n');
}

// מה חסר כדי לחתום
function missing(p) {
  const d = p.data || {}, out = [];
  if (p.kind === 'plan') {
    if (!d.a?.purpose) out.push('מטרת העבודה (פרק א)');
    if (!d.a?.activities) out.push('הפעילויות העיקריות (פרק א)');
    if (!d.a?.workers_max) out.push('מספר העובדים (פרק א)');
    if (!d.b?.acceptable) out.push('רמת הסיכון הקביל (פרק ב)');
    if (!d.c?.emergency) out.push('ארגון לשעת חירום (פרק ג)');
    const rk = (d.d?.risks || []).filter(r => r.risk);
    if (!rk.length) out.push('לפחות סיכון אחד (פרק ד)');
    else if (rk.some(r => !r.measures || !r.responsible)) out.push('אמצעי בקרה ואחראי לכל סיכון (פרק ד)');
  } else if (!(d.rows || []).some(r => r.resource)) out.push('לפחות משאב אחד');
  return out;
}

// ===== המסך =====
export function tabPlan(s) {
  const dv = derive(s.profile || {});
  const el = h(`<div>
    ${dv.planType === 'mgmt' ? '<div class="banner">באתר שבו מועסקים 50 עובדים ומעלה בו-זמנית נדרשת תוכנית לניהול הבטיחות לפי תקנות ארגון הפיקוח על העבודה (תכנית לניהול הבטיחות), התשע"ג-2013. הטופס כאן בנוי לפי התוספת השלישית (תקנה 166). את התוכנית המלאה מצרפים כקובץ לחובה בלשונית החובות.</div>' : ''}
    ${!dv.planType ? '<div class="banner">באתר מסוג תקנה 2(ז) תקנה 166 לא חלה. אפשר בכל זאת להכין תוכנית.</div>' : ''}
    ${['plan', 'resources'].map(k => block(s, k)).join('')}</div>`);
  $$('[data-new]', el).forEach(b => b.onclick = () => newPlan(s, b.dataset.new));
  $$('[data-edit]', el).forEach(b => b.onclick = () => editPlan(s, findPlan(b.dataset.edit)));
  $$('[data-psign]', el).forEach(b => b.onclick = () => signPlan(s, findPlan(b.dataset.psign), b.dataset.slot));
  $$('[data-pdf]', el).forEach(b => b.onclick = () => { const p = findPlan(b.dataset.pdf); p.pdf_path ? openFile(p.pdf_path) : savePlanPdf(s, p, true).catch(x => toast(x.message, 'bad')); });
  $$('[data-ver]', el).forEach(b => b.onclick = () => newVersion(s, findPlan(b.dataset.ver)));
  $$('[data-view]', el).forEach(b => b.onclick = () => viewPlan(s, findPlan(b.dataset.view)));
  return el;
}
const findPlan = id => (S.data.safety_plans || []).find(p => p.id === id);

function block(s, kind) {
  const list = plansOf(s.id, kind), p = list[0];
  const title = kind === 'plan' ? 'תוכנית ארגון בטיחות לאתר' : 'נספח משאבים ליישום תוכנית הבטיחות';
  const sub = kind === 'plan' ? `${PLAN_REF}. מבצע הבנייה מכין וחותם, ומוסר העתק לבקר הבטיחות ולמנהל האתר (תקנה 2(א)(3)). העתק מצורף לפנקס הכללי ונמצא באתר.`
    : `${RES_REF}. בהסכם עם מבצע הבנייה מפרטים את המשאבים ליישום התוכנית, לפי פרקיה והסיכונים שבה. חותמים היזם ומבצע הבנייה.`;
  const edit = canEditPlan(s.id, kind);
  if (!p) return `<div class="card"><h2>${title}</h2><p class="small mut">${esc(sub)}</p>${edit ? `<button class="btn big" data-new="${kind}">הכנת ${kind === 'plan' ? 'התוכנית' : 'הנספח'}</button>` : '<div class="empty small">עוד לא הוכן</div>'}</div>`;
  const cs = curSigs(p), done = planDone(p), miss = missing(p);
  const status = done ? `<span class="chip green">נחתם · גרסה ${p.version}</span>` : Object.keys(cs).length ? '<span class="chip amber">חתום חלקית</span>' : '<span class="chip amber">טיוטה</span>';
  return `<div class="card"><div class="dh"><h2>${title} ${status}</h2></div><p class="small mut">${esc(sub)}</p>
    <div class="kv small"><span>גרסה</span><b>${p.version} · עודכנה ${fmtDT(p.updated_at || p.created_at)}</b>
      ${SLOTS[kind].map(([k, l]) => `<span>חתימת ${l}</span><b>${cs[k] ? `✓ ${esc(cs[k].signer_name)}, ${fmtDT(cs[k].signed_at)}` : '<span class="mut">ממתין</span>'}</b>`).join('')}</div>
    ${!p.locked_hash && miss.length ? `<div class="small neg">לפני חתימה צריך להשלים: ${esc(miss.join(', '))}</div>` : ''}
    <div class="actions"><button class="btn ghost" data-view="${p.id}">צפייה בנוסח</button>
      ${edit && !p.locked_hash ? `<button class="btn ghost" data-edit="${p.id}">עריכה</button>` : ''}
      ${SLOTS[kind].filter(([k]) => !cs[k] && canSlot(s.id, k)).map(([k, l]) => `<button class="btn" data-psign="${p.id}" data-slot="${k}" ${miss.length ? 'disabled' : ''}>חתימת ${l}</button>`).join('')}
      ${done ? `<button class="btn ghost" data-pdf="${p.id}">PDF</button>` : ''}
      ${edit && p.locked_hash ? `<button class="btn ghost" data-ver="${p.id}">גרסה חדשה</button>` : ''}</div>
    ${list.length > 1 ? `<details><summary class="small">גרסאות קודמות (${list.length - 1})</summary>${list.slice(1).map(x => `<div class="small">גרסה ${x.version} · ${planDone(x) ? 'נחתמה' : 'לא נחתמה'} · ${fmtDate(x.created_at)} ${x.pdf_path ? `<button type="button" class="btn link" data-pdf="${x.id}">PDF</button>` : ''}</div>`).join('')}</details>` : ''}</div>`;
}

async function newPlan(s, kind) {
  try {
    const [p] = await db.insert('safety_plans', { id: uuid(), site_id: s.id, kind, version: 1, data: kind === 'plan' ? prefill(s) : resPrefill(s), locked_hash: null, updated_at: new Date().toISOString() });
    (S.data.safety_plans ||= []).push(p);
    render(); editPlan(s, p);
  } catch (e) { toast(e.message, 'bad'); }
}
async function newVersion(s, p) {
  try {
    const [n] = await db.insert('safety_plans', { id: uuid(), site_id: s.id, kind: p.kind, version: plansOf(s.id, p.kind)[0].version + 1, data: JSON.parse(JSON.stringify(p.data || {})), locked_hash: null, updated_at: new Date().toISOString() });
    (S.data.safety_plans ||= []).push(n);
    toast(`נפתחה גרסה ${n.version}. הגרסה החתומה נשמרת כמו שהיא`); render(); editPlan(s, n);
  } catch (e) { toast(e.message, 'bad'); }
}

// ===== עריכה =====
const tblEditor = (name, cols, rows) => `<div class="pe-tbl" data-tbl="${name}">${(rows || []).map(r => rowEditor(cols, r)).join('')}<button type="button" class="btn small ghost" data-addrow>＋ שורה</button></div>`;
const rowEditor = (cols, r = {}) => `<div class="pe-row">${cols.map(([c, l]) => `<label class="fld"><span>${esc(l)}</span>${c === 'measures' || c === 'resource' ? `<textarea rows="2" data-c="${c}">${esc(r[c] || '')}</textarea>` : `<input data-c="${c}" value="${esc(r[c] || '')}">`}</label>`).join('')}<button type="button" class="btn small ghost danger" data-delrow aria-label="מחיקת השורה">✕</button></div>`;
const readTbl = (el, name) => $$(`[data-tbl="${name}"] .pe-row`, el).map(r => Object.fromEntries($$('[data-c]', r).map(i => [i.dataset.c, i.value.trim()]))).filter(r => Object.values(r).some(Boolean));

function editPlan(s, p) {
  const d = JSON.parse(JSON.stringify(p.data || {}));
  const body = p.kind === 'plan' ? PARTS.map((part, i) => `<details class="pe-part" ${i === 0 ? 'open' : ''}><summary><b>${esc(part.t)}</b></summary>${part.f.map(([k, label, type]) => {
      const v = (d[part.k] || {})[k];
      if (type === 'auto') return `<div class="fld"><span>${esc(label)}</span><div class="small pre">${esc(rolesText(s) || 'לא נרשמו בעלי תפקידים')}</div></div>`;
      if (type === 'risks') return `<div class="fld"><span>${esc(label)}</span>${tblEditor('risks', RISK_COLS, v)}</div>`;
      if (type === 'procs') return `<div class="fld"><span>${esc(label)}</span>${tblEditor('procs', PROC_COLS, v)}</div>`;
      return `<label class="fld"><span>${esc(label)}</span>${type === 'text' ? `<input data-k="${part.k}.${k}" value="${esc(v || '')}">` : `<textarea rows="3" data-k="${part.k}.${k}">${esc(v || '')}</textarea>`}</label>`;
    }).join('')}</details>`).join('')
    : `<div class="fld"><span>המשאבים, לפי פרקי התוכנית ולפי כל סיכון</span>${tblEditor('rows', RES_COLS, d.rows)}</div><label class="fld"><span>הערות</span><textarea rows="2" data-k="note">${esc(d.note || '')}</textarea></label>`;
  const el = h(`<div class="ov full" role="dialog" aria-modal="true"><div class="dlg wide pe"><div class="dlg-h"><h3>${p.kind === 'plan' ? 'תוכנית ארגון בטיחות' : 'נספח משאבים'} · גרסה ${p.version} · טיוטה</h3><button class="x" aria-label="סגירה" data-x>✕</button></div>
    <div class="dlg-b">${body}<p class="small mut">הטיוטה נשמרת בלחיצה על "שמירה". אחרי החתימה הראשונה הנוסח ננעל.</p></div>
    <div class="dlg-f"><button class="btn ghost" data-x>ביטול</button><button class="btn" data-save>שמירה</button></div></div></div>`);
  document.body.appendChild(el);
  const close = () => el.remove();
  $$('[data-x]', el).forEach(b => b.onclick = close);
  el.addEventListener('click', e => {
    if (e.target.matches('[data-addrow]')) { const t = e.target.closest('[data-tbl]'), cols = { risks: RISK_COLS, procs: PROC_COLS, rows: RES_COLS }[t.dataset.tbl]; e.target.insertAdjacentHTML('beforebegin', rowEditor(cols)); }
    if (e.target.matches('[data-delrow]')) e.target.closest('.pe-row').remove();
  });
  $('[data-save]', el).onclick = async e => {
    const out = JSON.parse(JSON.stringify(d));
    for (const i of $$('[data-k]', el)) { const [a, b] = i.dataset.k.split('.'); if (b) (out[a] ||= {})[b] = i.value.trim(); else out[a] = i.value.trim(); }
    if (p.kind === 'plan') { (out.d ||= {}).risks = readTbl(el, 'risks'); (out.h ||= {}).procs = readTbl(el, 'procs'); } else out.rows = readTbl(el, 'rows');
    e.target.disabled = true;
    try { const r = await db.update('safety_plans', p.id, { data: out, updated_at: new Date().toISOString() }); Object.assign(p, r); close(); toast('הטיוטה נשמרה'); render(); }
    catch (x) { e.target.disabled = false; toast(x.message, 'bad'); }
  };
}

function viewPlan(s, p) {
  modal({ title: (p.kind === 'plan' ? 'תוכנית ארגון בטיחות' : 'נספח משאבים') + ` · גרסה ${p.version}`, ok: null, cancel: 'סגירה', wide: true,
    body: `<div class="sgdoc pre">${esc(p.locked_hash ? (sigsOf(p).find(g => g.doc_hash === p.locked_hash)?.doc_snapshot || planText(s, p)) : planText(s, withRoles(s, p)))}</div>` });
}
// בעלי התפקידים נקבעים בנוסח ברגע החתימה
const withRoles = (s, p) => p.kind === 'plan' ? { ...p, data: { ...p.data, c: { ...(p.data?.c || {}), roles: rolesText(s) } } } : p;

// ===== חתימה =====
async function signPlan(s, p, slot) {
  if (missing(p).length) return toast('צריך להשלים: ' + missing(p).join(', '), 'bad');
  const label = SLOTS[p.kind].find(([k]) => k === slot)[1];
  const me = S.data.site_people.find(x => x.site_id === s.id && x.active !== false && (x.email || '').toLowerCase() === (S.user?.email || '').toLowerCase());
  const orgName = slot === 'dev' ? siteOrgs(s.id, 'developer').map(o => o.name).join(', ') : conNames(s.id).join(', ');
  // התוכנית: בעלי התפקידים נכנסים לנוסח לפני החתימה הראשונה
  if (!p.locked_hash && p.kind === 'plan') {
    try { const r = await db.update('safety_plans', p.id, { data: withRoles(s, p).data, updated_at: new Date().toISOString() }); Object.assign(p, r); } catch (x) { return toast(x.message, 'bad'); }
  }
  const text = planText(s, p), hash = await sha256Hex(text);
  if (p.locked_hash && p.locked_hash !== hash) return toast('הנוסח השתנה מאז החתימה הקודמת. פותחים גרסה חדשה', 'bad');
  const el = h(`<div class="ov full" role="dialog" aria-modal="true"><div class="dlg wide"><div class="dlg-h"><h3>חתימת ${esc(label)}</h3><button class="x" aria-label="סגירה" data-x>✕</button></div>
    <div class="dlg-b"><details><summary><b>הנוסח המלא</b></summary><div class="sgdoc pre">${esc(text)}</div></details>
      <div class="grid g2"><label class="fld"><span>שם החותם</span><input name="n" value="${esc((me?.name || '').replace(/ \(.*\)$/, ''))}"></label><label class="fld"><span>תפקיד</span><input name="t" value="${esc(orgName ? 'מטעם ' + orgName : label)}"></label></div>
      <canvas class="sgpad" aria-label="משטח חתימה"></canvas>
      <label class="chk"><input type="checkbox" name="ok"> קראתי את ${p.kind === 'plan' ? 'התוכנית' : 'הנספח'} ואני מאשר/ת את הנוסח</label>
      <p class="small mut">נשמרים: החתימה, השם, המשתמש המחובר, שעת השרת והנוסח המלא עם טביעת אצבע (SHA-256). אחרי החתימה אי אפשר לשנות את הנוסח.</p></div>
    <div class="dlg-f"><button class="btn ghost" data-clear>ניקוי</button><button class="btn" data-ok>חתימה</button></div></div></div>`);
  document.body.appendChild(el);
  const pd = pad($('canvas', el));
  $$('[data-x]', el).forEach(b => b.onclick = () => el.remove());
  $('[data-clear]', el).onclick = pd.clear;
  $('[data-ok]', el).onclick = async e => {
    const name = $('[name=n]', el).value.trim();
    if (!name) return toast('צריך שם חותם', 'bad');
    if (pd.empty()) return toast('צריך לחתום במשטח', 'bad');
    if (!$('[name=ok]', el).checked) return toast('צריך לאשר שקראת את הנוסח', 'bad');
    e.target.disabled = true;
    try {
      const [g] = await db.insert('signatures', { site_id: s.id, doc_type: p.kind === 'plan' ? 'safety_plan' : 'safety_resources', doc_ref: p.id, doc_hash: hash, doc_snapshot: text, slot,
        signer_name: name, signer_title: $('[name=t]', el).value.trim(), image: pd.png(), user_agent: navigator.userAgent.slice(0, 300), signed_by_email: S.user?.email || '', signed_at: new Date().toISOString() });
      (S.data.signatures ||= []).push(g);
      // הנעילה נעשית בשרת עם החתימה הראשונה. במצב הדגמה שומרים כאן
      if (!p.locked_hash) { const r = await db.select('safety_plans', { eq: { id: p.id } }).catch(() => []); if (r[0]?.locked_hash) Object.assign(p, r[0]); else { const x = await db.update('safety_plans', p.id, { locked_hash: hash }); Object.assign(p, x); } }
      el.remove(); toast('החתימה נשמרה');
      if (planDone(p)) await afterSigned(s, p);
      render();
    } catch (x) { e.target.disabled = false; toast(x.message, 'bad'); }
  };
}

// כל החתימות קיימות: PDF, והחובה המתאימה נסגרת
async function afterSigned(s, p) {
  try { await savePlanPdf(s, p); } catch (x) { toast('החתימות נשמרו, אבל שמירת ה-PDF נכשלה: ' + x.message, 'bad'); }
  const key = p.kind === 'plan' ? 'con_plan' : 'dev_resources';
  const duty = S.data.duties.find(d => d.site_id === s.id && d.key === key && d.status === 'open');
  if (!duty) return;
  const cs = curSigs(p);
  const note = p.kind === 'plan'
    ? `תוכנית ארגון בטיחות (גרסה ${p.version}) נחתמה במערכת בידי ${cs.con.signer_name} (מבצע הבנייה). התוכנית זמינה במערכת לבקר הבטיחות ולמנהל האתר, ויש להניח העתק בפנקס הכללי באתר.`
    : `נספח משאבים (גרסה ${p.version}) נחתם במערכת בידי ${cs.dev.signer_name} (היזם) ו${cs.con.signer_name} (מבצע הבנייה).`;
  try {
    const r = await db.update('duties', duty.id, { status: 'done', done_at: new Date().toISOString(), closed_at: new Date().toISOString(), done_by: S.user?.email || '',
      evidence_note: note, evidence_ref: 'חתימה במערכת ' + String(p.locked_hash || '').slice(0, 12), ...(p.pdf_path ? { file_path: p.pdf_path } : {}) });
    Object.assign(duty, r); await syncSite(s, false); toast('נחתם, והחובה נסגרה');
  } catch (x) { toast('נחתם, אבל סגירת החובה נכשלה: ' + x.message, 'bad'); }
}

export async function planPdf(s, p) {
  const d = p.data || {}, cs = curSigs(p), blocks = [];
  if (p.kind === 'plan') {
    blocks.push({ type: 'title', text: 'תוכנית ארגון בטיחות לאתר', brand: 'צי הנדסה', sub: `${s.name}${s.address ? ', ' + s.address : ''} · גרסה ${p.version} · לפי ${PLAN_REF}` },
      { type: 'kv', rows: [['מבצע הבנייה', conNames(s.id).join(', ') || '—'], ['היזם', siteOrgs(s.id, 'developer').map(o => o.name).join(', ') || '—']] });
    for (const part of PARTS) {
      blocks.push({ type: 'p', text: part.t, bold: true, size: 24, color: '#1C3A5E' });
      const kv = [];
      for (const [k, label, type] of part.f) {
        const v = (d[part.k] || {})[k];
        if (type === 'risks') { if (kv.length) blocks.push({ type: 'kv', rows: kv.splice(0) }); blocks.push({ type: 'table', cols: RISK_COLS.map(([, hh, w]) => ({ h: hh, w })), rows: (v || []).map(r => RISK_COLS.map(([c]) => r[c] || '')) }); }
        else if (type === 'procs') { if (kv.length) blocks.push({ type: 'kv', rows: kv.splice(0) }); blocks.push({ type: 'table', cols: PROC_COLS.map(([, hh, w]) => ({ h: hh, w })), rows: (v || []).map(r => PROC_COLS.map(([c]) => r[c] || '')) }); }
        else kv.push([label, v || '—']);
      }
      if (kv.length) blocks.push({ type: 'kv', rows: kv });
    }
  } else {
    blocks.push({ type: 'title', text: 'נספח משאבים ליישום תוכנית הבטיחות', brand: 'צי הנדסה', sub: `${s.name}${s.address ? ', ' + s.address : ''} · גרסה ${p.version} · לפי ${RES_REF}` },
      { type: 'kv', rows: [['היזם (המזמין)', siteOrgs(s.id, 'developer').map(o => o.name).join(', ') || '—'], ['מבצע הבנייה', conNames(s.id).join(', ') || '—']] },
      { type: 'table', cols: RES_COLS.map(([, hh, w]) => ({ h: hh, w })), rows: (d.rows || []).map(r => RES_COLS.map(([c]) => r[c] || '')) });
    if (d.note) blocks.push({ type: 'p', text: 'הערות: ' + d.note });
  }
  for (const [k, l] of SLOTS[p.kind]) {
    const g = cs[k]; if (!g) continue;
    blocks.push({ type: 'p', text: `חתימת ${l}: ${g.signer_name}${g.signer_title ? ', ' + g.signer_title : ''} · ${fmtDT(g.signed_at)}`, bold: true, size: 20, color: '#111' }, { type: 'sig', img: await loadImg(g.image) });
  }
  blocks.push({ type: 'p', size: 15, color: '#666', text: `הופק ממערכת ניהול הבטיחות של צי הנדסה, ${fmtDT(new Date().toISOString())}. החתימות נשמרו במערכת עם שעת השרת, ואינן ניתנות לעריכה או למחיקה. טביעת אצבע (SHA-256) של הנוסח החתום: ${p.locked_hash || '—'}` });
  return pagesToPdf(await renderPdfPages(blocks, `${s.name} · ${p.kind === 'plan' ? 'תוכנית ארגון בטיחות' : 'נספח משאבים'} · גרסה ${p.version}`));
}
async function savePlanPdf(s, p, open = false) {
  const win = open ? window.open('', '_blank') : null;
  try {
    const blob = await planPdf(s, p);
    const path = `${s.id}/plans/${p.id}/v${p.version}-${new Date().toISOString().replace(/[:.]/g, '-')}.pdf`;
    await db.putFile(path, new File([blob], 'plan.pdf', { type: 'application/pdf' }));
    const r = await db.update('safety_plans', p.id, { pdf_path: path }); Object.assign(p, r, { pdf_path: path });
    if (win) win.location.href = URL.createObjectURL(blob);
  } catch (x) { win?.close?.(); throw x; }
}
