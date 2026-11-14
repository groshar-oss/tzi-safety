// מסך אתר: סקירה, חובות, אירועים, בעלי תפקידים, יומן ביקורת
import { db } from '../db.js';
import { S, siteById, myRoles, hasRole, canEditSite, siteOrgs, render, sideOf, conNames } from '../app.js';
import { derive, profileNotes, gateStatus, ROLES, ASSIGNABLE, EVENTS, CAT, LEVELS, level, WORK_TYPES } from '../duties.js';
import { exceptions } from '../alerts.js';
import { esc, h, $, $$, toast, modal, field, select, area, fmtDate } from '../util.js';
import { dutyCard, compliance, gauge, openDuty, reportEvent, canReport, fmtDT, sideName } from './common.js';
import { statusName } from './home.js';
import { checkinCard, checkinsFor } from './checkin.js';
import { siteSign } from './docs.js';
import { openAuthSign, authStatus } from './sign.js';
import { tabWorkers, canSeeWorkers } from './workers.js';
import { tabEquipment } from './equipment.js';
import { tabRecurring } from './recurring.js';
import { tabInspect, canInspect } from './inspect.js';
import { tabDefects, defectSummary, defectsOf, SEV } from './defects.js';
import { accidentForm, accidentOf, canAccident } from './reports.js';
import { tabPlan } from './plan.js';
import { monthlyReport, canMonthly } from './monthly.js';
import { TRAINING_KINDS, sigsOfTraining, equipmentOf, headcount, renderPdfPages, pagesToPdf } from '../workers.js';

const TABS = [['overview', 'סקירה'], ['recurring', 'משימות חוזרות'], ['workers', 'עובדים והדרכות'], ['equipment', 'ציוד ותסקירים'], ['defects', 'ליקויים'], ['plan', 'תוכנית בטיחות'], ['duties', 'חובות'], ['events', 'אירועים'], ['people', 'בעלי תפקידים'], ['log', 'פנקס כללי'], ['audit', 'יומן ביקורת']];

export function viewSite(id, tab = 'overview', c, d) {
  const s = siteById(id);
  if (!s || !myRoles(id).length) return h('<div class="card empty">האתר לא נמצא או שאין לך גישה אליו</div>');
  const body = tab === 'inspect' ? tabInspect(s) : tab === 'workers' ? tabWorkers(s, c, d) : tab === 'equipment' ? tabEquipment(s, c) : tab === 'defects' ? tabDefects(s, c) : tab === 'plan' ? tabPlan(s) : tab === 'recurring' ? tabRecurring(s) : tab === 'duties' ? tabDuties(s, c) : tab === 'events' ? tabEvents(s) : tab === 'people' ? tabPeople(s) : tab === 'audit' ? tabAudit(s) : tab === 'log' ? tabLog(s) : tabOverview(s);
  const el = h(`<div><div class="top"><div><h1>${esc(s.name)}</h1><div class="sub">${esc(s.address || '')} · ${esc(WORK_TYPES[s.profile?.work_type] || '')} · <span class="chip">${esc(statusName(s.status))}</span></div></div>
    <div class="actions">${canInspect(s.id) ? `<a class="btn ${tab === 'inspect' ? '' : 'ghost'}" href="#/site/${s.id}/inspect">ביקורת באתר</a>` : ''}${canReport(s.id) ? '<button class="btn" data-ev>דיווח אירוע</button>' : ''}<button class="btn ghost" data-sign>שלט אתר</button>${canMonthly(s.id) ? '<button class="btn ghost" data-month>דוח חודשי</button>' : ''}${hasRole(s.id, 'dev') ? `<a class="btn ghost" href="#/new-site/${s.id}">פרופיל משפטי</a>` : ''}</div></div>
    <nav class="tabs">${TABS.filter(([k]) => k !== 'workers' || canSeeWorkers(s.id)).map(([k, l]) => `<a href="#/site/${s.id}/${k}" class="${k === tab ? 'on' : ''}">${l}</a>`).join('')}</nav>
    <div id="tabBody"></div></div>`);
  $('#tabBody', el).appendChild(body);
  $('[data-ev]', el)?.addEventListener('click', () => eventForm(s));
  $('[data-ev2]', el)?.addEventListener('click', () => eventForm(s));
  $('[data-sign]', el)?.addEventListener('click', () => siteSign(s));
  $('[data-month]', el)?.addEventListener('click', () => monthlyReport(s));
  el.addEventListener('mounted', () => body.dispatchEvent(new Event('mounted')));
  // קישור ישיר לחובה: #/site/{id}/duties/{dutyId}
  if (tab === 'duties' && c && S.data.duties.some(x => x.id === c)) el.addEventListener('mounted', () => { if (!document.querySelector('.ov')) openDuty(c); });
  void d;
  return el;
}

// ===== סקירה =====
function tabOverview(s) {
  const dv = derive(s.profile || {});
  const list = S.data.duties.filter(x => x.site_id === s.id);
  const ex = exceptions(S.data, [s]);
  const g = gateStatus(list);
  const c = compliance(s.id);
  const k = lv => ex.filter(x => x.level === lv).length;
  const people = S.data.site_people.filter(p => p.site_id === s.id && p.active !== false && !p.backup);
  const who = r => people.filter(p => p.role === r).map(p => esc(p.name)).join(', ');
  const devs = siteOrgs(s.id, 'developer').map(o => esc(o.name)).join(', ');
  const cons = conNames(s.id).map(esc).join(', ');
  const el = h(`<div>
    ${dv.clientDuties && !people.some(p => p.role === 'bakar') ? `<div class="banner crit">⛔ אין בקר בטיחות ממונה. כל עוד לא מונה, חובות הבקר חלות על היזם (תקנה 1א(ב)).<div class="actions"><a class="btn small" href="#/site/${s.id}/people">רישום בקר בטיחות</a></div></div>` : ''}
    ${wmBanner(s)}
    ${hcBanner(s)}
    ${checkinCard(s)}
    ${dv.devIsExecutor ? '<div class="banner crit">יש באתר יותר מקבלן ראשי אחד ואף אחד מהם לא קיבל אחריות כוללת בכתב: היזם הוא מבצע הבנייה (תקנה 6(ג)).</div>' : ''}
    <div class="kpis">
      <div class="kpi">${gauge(c)}</div>
      <div class="kpi"><div class="l">קריטי</div><div class="v" style="color:#7a0f0f">${k('crit')}</div></div>
      <div class="kpi"><div class="l">חריגות</div><div class="v neg">${k('red')}</div></div>
      <div class="kpi"><div class="l">אזהרות</div><div class="v" style="color:#e08a00">${k('warn')}</div></div>
    </div>
    <div class="cols"><div>
      ${s.status === 'planning' || g.missing.length ? `<div class="card gate"><h2>שער התחלת עבודה <span class="mut small">${g.items.length - g.missing.length} מתוך ${g.items.length}</span></h2>
        <p class="small mut">לפי תקנה 1א(א), המזמין מאשר בכתב להתחיל בעבודות רק אחרי שכל התנאים התקיימו.</p>
        ${g.items.map(i => `<a class="gi ${i.status === 'open' ? 'no' : 'yes'}" href="#/site/${s.id}/duties/${i.id}">${i.status === 'open' ? '✗' : '✓'} ${esc(i.title)} <span class="mut small">${esc(sideName(i.side))}</span></a>`).join('')}</div>` : ''}
      ${defCard(s)}
      <div class="card"><h2>חריגות פתוחות <span class="mut small">${ex.length}</span></h2>
        ${ex.length ? ex.slice(0, 15).map(x => dutyCard(x.duty)).join('') + (ex.length > 15 ? `<a class="btn ghost small" href="#/site/${s.id}/duties">כל החובות</a>` : '') : '<div class="empty">אין חריגות פתוחות 👍</div>'}</div>
    </div><div>
      <div class="card"><h2>מי באתר</h2><div class="kv">
        <span>יזם</span><b>${devs || '—'}</b><span>קבלן ראשי</span><b>${cons || '—'}</b>
        ${['dev', 'bakar', 'con', 'sm', 'wm', 'rep', 'so', 'fa'].filter(r => r !== 'rep' || dv.exempt27).map(r => `<span>${ROLES[r]}</span><b>${who(r) || '<span class="mut">לא מונה</span>'}</b>`).join('')}</div>
        <a class="btn ghost small" href="#/site/${s.id}/people">ניהול בעלי תפקידים</a></div>
      <div class="card"><h2>מה חל על האתר</h2>${profileNotes(s.profile || {}).map(([k2, t]) => `<div class="pn ${k2}">${k2 === 'ok' ? '✓' : k2 === 'warn' ? '!' : '–'} ${esc(t)}</div>`).join('')}
        <div class="kv small"><span>שטח לפי ההיתר</span><b>${(+s.profile?.area || 0).toLocaleString('he-IL')} מ"ר</b><span>עובדים מרבי</span><b>${+s.profile?.workers_max || 0}</b><span>מועד התחלה</span><b>${fmtDate(s.profile?.start_date)}</b><span>היתר</span><b>${esc(s.profile?.permit_no || '—')}</b></div></div>
    </div></div></div>`);
  return el;
}

export function hcBanner(s) {
  const hc = headcount(s);
  return hc.msgs.length ? `<div class="banner">${hc.msgs.map(esc).join('<br>')}${hasRole(s.id, 'dev') ? `<div class="actions"><a class="btn small" href="#/new-site/${s.id}">עדכון הפרופיל המשפטי</a></div>` : ''}</div>` : '';
}
export function defCard(s) {
  const d = defectSummary(s.id);
  if (!d.open) return '';
  return `<a class="card fsum" href="#/site/${s.id}/defects"><h2>ליקויי בטיחות פתוחים <span class="mut small">${d.open}</span></h2>
    <div>${d.crit ? `<span class="chip red">${d.crit} סיכון מיידי</span>` : ''}${d.late ? `<span class="chip red">${d.late} באיחור</span>` : ''}${!d.crit && !d.late ? '<span class="chip amber">בטיפול</span>' : ''}</div></a>`;
}

// באנר לאתר פטור ממינוי מנהל עבודה (תקנה 2(ז)): מי מבצע בפועל את חובות מנהל העבודה
export function wmBanner(s) {
  const dv = derive(s.profile || {});
  const act = r => S.data.site_people.filter(p => p.site_id === s.id && p.role === r && p.active !== false);
  if (!dv.exempt27 || act('wm').length) return '';
  const rep = act('rep').filter(p => !p.backup), bk = act('rep').filter(p => p.backup);
  const proof = S.data.duties.find(d => d.site_id === s.id && d.key === 'con_exempt_proof');
  const unverified = proof && proof.status === 'open';
  const fix = unverified ? `<div class="actions"><a class="btn small" href="#/site/${s.id}/duties/${proof.id}">📷 צירוף המסמך שמוכיח את הפטור</a></div>` : '';
  return rep.length
    ? `<div class="banner">חובות מנהל העבודה חלות על מבצע הבנייה (תקנה 2(ז)). מבצע בפועל באתר: <b>${rep.map(p => esc(p.name)).join(', ')}</b>${bk.length ? ` · ממלא מקום: ${bk.map(p => esc(p.name)).join(', ')}` : ' · <span class="neg">אין ממלא מקום</span>'}${unverified ? '<br><span class="neg">הסיווג לפי 2(ז) עוד לא מאומת: חסר מסמך שמוכיח את הפטור. עד הצירוף יש לעבוד עם מנהל עבודה רשום.</span>' : ''}${fix}</div>`
    : `<div class="banner crit">⛔ חובות מנהל העבודה חלות על מבצע הבנייה (תקנה 2(ז)), ואין באתר אדם שמבצע אותן. רושמים נציג מבצע הבנייה בלשונית "בעלי תפקידים", או ממנים מנהל עבודה.${unverified ? '<br>הסיווג לפי 2(ז) עוד לא מאומת: חסר מסמך שמוכיח את הפטור.' : ''}<div class="actions"><a class="btn small" href="#/site/${s.id}/people">רישום נציג באתר</a>${unverified ? `<a class="btn small ghost" href="#/site/${s.id}/duties/${proof.id}">📷 צירוף המסמך שמוכיח את הפטור</a>` : ''}</div></div>`;
}

// ===== חובות =====
function tabDuties(s) {
  const st = { side: sideOf(s.id) === 'all' ? '' : '', status: 'open', q: '' };
  const el = h(`<div><div class="card filters">
      ${select('צד', 'side', { '': 'כל הצדדים', dev: 'צד היזם', con: 'צד הקבלן' }, st.side)}
      ${select('סטטוס', 'status', { open: 'פתוחות', exc: 'בחריגה בלבד', done: 'בוצעו', closed: 'לא חל / דחייה', all: 'הכול' }, st.status)}
      ${field('חיפוש', 'q', '', { attrs: 'placeholder="שם חובה או תקנה"' })}</div>
    <div id="dl"></div></div>`);
  const draw = () => {
    const now = Date.now();
    let list = S.data.duties.filter(x => x.site_id === s.id);
    if (st.side) list = list.filter(x => x.side === st.side);
    if (st.status === 'open') list = list.filter(x => x.status === 'open');
    if (st.status === 'exc') list = list.filter(x => x.status === 'open' && ['crit', 'red'].includes(level(x, now)));
    if (st.status === 'done') list = list.filter(x => x.status === 'done');
    if (st.status === 'closed') list = list.filter(x => ['na', 'waived'].includes(x.status));
    if (st.q) { const q = st.q.toLowerCase(); list = list.filter(x => (x.title + ' ' + x.ref).toLowerCase().includes(q)); }
    const rank = x => LEVELS[level(x, now)]?.rank ?? 0;
    list.sort((a, b) => rank(b) - rank(a) || String(a.due_at || '9').localeCompare(String(b.due_at || '9')));
    // קיבוץ: פתוחות לפי צד
    const groups = [['dev', 'צד היזם'], ['con', 'צד הקבלן']].map(([k, l]) => [l, list.filter(x => x.side === k)]).filter(([, a]) => a.length);
    $('#dl', el).innerHTML = list.length ? groups.map(([l, a]) => `<div class="card"><h2>${l} <span class="mut small">${a.length}</span></h2>${a.map(x => dutyCard(x)).join('')}</div>`).join('') : '<div class="card empty">אין חובות שמתאימות לסינון</div>';
  };
  $$('.filters select, .filters input', el).forEach(i => i.addEventListener('input', () => { st[i.name] = i.value; draw(); }));
  draw();
  return el;
}

// ===== אירועים =====
function tabEvents(s) {
  const evs = S.data.events.filter(e => e.site_id === s.id).sort((a, b) => String(b.occurred_at).localeCompare(String(a.occurred_at)));
  const spawned = e => S.data.duties.filter(d => d.event_id === e.id);
  const el = h(`<div><div class="card"><h2>אירועים באתר</h2>
    <p class="small mut">כל אירוע פותח את החובות שהתקנות מחייבות בעקבותיו, עם מועד. למשל: דיווח על סיכון שאינו קביל פותח חובת תגובה לקבלן וחובת אישור בכתב ליזם תוך 48 שעות.</p>
    ${canReport(s.id) ? '<button class="btn" data-ev2>דיווח אירוע חדש</button>' : ''}</div>
    ${evs.map(e => `<div class="card ev ${EVENTS[e.type]?.critical ? 'crit' : ''}"><div class="dh"><b>${esc(EVENTS[e.type]?.label || e.type)}</b><span class="mut small">${fmtDT(e.occurred_at)}</span></div>
      ${e.description ? `<p>${esc(e.description)}</p>` : ''}<div class="small mut">דיווח: ${esc(e.reported_by || '')}</div>
      ${e.type === 'accident' && (canAccident(s.id) || accidentOf(e.id)) ? `<div class="actions"><button class="btn small" data-acc="${e.id}">📋 ${accidentOf(e.id) ? 'תיעוד התאונה' + (accidentOf(e.id).closed_at ? ' (הסתיים)' : '') : 'תיעוד התאונה: צילומים ועדים'}</button></div>` : ''}
      ${spawned(e).map(x => dutyCard(x)).join('')}</div>`).join('') || '<div class="card empty">לא דווחו אירועים</div>'}</div>`);
  $$('[data-acc]', el).forEach(b => b.onclick = () => accidentForm(s, evs.find(e => e.id === b.dataset.acc)));
  return el;
}

export const eventFormFor = (s, type) => eventForm(s, type);
async function eventForm(s, type = 'unacceptable') {
  const now = new Date(); const local = new Date(now - now.getTimezoneOffset() * 6e4).toISOString().slice(0, 16);
  const opts = Object.fromEntries(Object.entries(EVENTS).map(([k, v]) => [k, v.label]));
  const v = await modal({ title: 'דיווח אירוע', ok: 'דיווח',
    body: `${select('סוג האירוע', 'type', opts, type)}
      ${field('מתי קרה', 'at', local, { type: 'datetime-local', req: true })}
      ${area('תיאור (מה, איפה, מי)', 'desc')}
      <div class="note small" id="evh"></div>`,
    onMount: el => {
      const upd = () => { const t = $('[name=type]', el).value; $('#evh', el).textContent = 'ייפתחו חובות: ' + (EVENTS[t].spawn || []).map(k => CAT[k]?.title || k).join(' · '); };
      $('[name=type]', el).addEventListener('change', upd); upd();
    },
    validate: d => !d.at ? 'צריך מועד' : new Date(d.at) > new Date(Date.now() + 6e4) ? 'מועד האירוע לא יכול להיות בעתיד' : (d.desc || '').trim().length < 3 ? 'צריך תיאור קצר' : null });
  if (!v) return;
  try {
    await reportEvent(s, { type: v.type, occurred_at: new Date(v.at).toISOString(), description: v.desc.trim() });
    location.hash = `#/site/${s.id}/events`; render();
  } catch (e) { toast(e.message, 'bad'); }
}

// ===== בעלי תפקידים =====
// אותו אדם לא יכול להיות בקר וגם מנהל עבודה / מנהל אתר / ממונה; מנהל אתר לא יכול להיות גם מנהל עבודה או בקר
const CONFLICT = { bakar: ['wm', 'sm', 'so', 'rep'], sm: ['wm', 'bakar'], wm: ['bakar', 'sm'], so: ['bakar'], rep: ['bakar'] };
const sameP = (a, b) => (a.email && b.email && a.email.toLowerCase() === b.email.toLowerCase()) || (a.phone && b.phone && a.phone.replace(/\D/g, '') === b.phone.replace(/\D/g, '')) || a.name.trim() === b.name.trim();
// מי רשאי למנות: יזם ממנה בקר ונציג יזם; קבלן ממנה את בעלי התפקידים שלו
const canManage = (s, role) => hasRole(s.id, SIDE_OF_ROLE[role] === 'dev' ? 'dev' : 'con');
const SIDE_OF_ROLE = { dev: 'dev', bakar: 'dev', viewer: 'dev', con: 'con', rep: 'con', so: 'con', sm: 'con', wm: 'con', fa: 'con', sub: 'con' };

// למה התפקיד נדרש (מוצג בשורה של תפקיד חסר)
const WHY = { dev: 'מקבל את חובות המזמין והתראות צד היזם', bakar: 'חובה לפני אישור התחלת עבודה (תקנה 1א(א)(3))', con: 'מבצע הבנייה: אחראי לחובות צד הקבלן',
  wm: 'אסור לעבוד בלי מנהל עבודה רשום (תקנה 2(א)(1))', rep: 'אתר פטור (תקנה 2(ז)): אדם באתר שמבצע את חובות מנהל העבודה, עם צ׳ק-אין יומי',
  sm: 'אתר של 15,000 מ"ר ומעלה (תקנה 2(א)(2))', so: '100 עובדים ומעלה בו-זמנית (תקנה 4(3) לתקנות הממונים)', fa: 'אחראי ארגז עזרה ראשונה, נמצא באתר כל שעות העבודה (תקנה 187)' };
function tabPeople(s) {
  const all = S.data.site_people.filter(p => p.site_id === s.id);
  const order = Object.keys(ROLES);
  all.sort((a, b) => (a.active === false) - (b.active === false) || order.indexOf(a.role) - order.indexOf(b.role) || a.backup - b.backup);
  const dv = derive(s.profile || {});
  const hasWm = all.some(p => p.role === 'wm' && p.active !== false);
  const need = [['dev', dv.clientDuties], ['bakar', dv.clientDuties], ['con', true], ['wm', dv.wmRequired], ['rep', dv.exempt27 && !hasWm], ['sm', dv.siteMgr], ['so', dv.so], ['fa', true]];
  const missing = need.filter(([r, req]) => req && !all.some(p => p.role === r && p.active !== false));
  const el = h(`<div>
    ${missing.length ? `<div class="banner">חסרים בעלי תפקידים שהתקנות מחייבות: ${missing.map(([r]) => ROLES[r]).join(', ')}</div>` : ''}
    <div class="card"><div class="dh"><h2>בעלי תפקידים באתר</h2>${canEditSite(s.id) ? '<button class="btn small" data-add>הוספה</button>' : ''}</div>
    <p class="small mut">ההתראות נשלחות לפי התפקיד. טלפון משמש ל-WhatsApp ואימייל למיילים. מחליף מקבל התראה כשהאחראי לא טיפל תוך 24 שעות.</p>
    <div class="plist">${all.map(p => `<div class="prow ${p.active === false ? 'off' : ''}">
      <div><b>${esc(p.name)}</b> ${p.backup ? '<span class="chip">מחליף</span>' : ''}${p.active === false ? '<span class="chip">לא פעיל</span>' : ''}<div class="small mut">${ROLES[p.role] || p.role}${p.license ? ' · ' + esc(p.license) : ''}</div></div>
      <div class="small" dir="ltr">${esc(p.phone || '')}<br>${esc(p.email || '')}</div>
      <div class="actions">${p.role === 'rep' && p.active !== false ? `<button class="btn small ${authStatus(p) === 'signed' ? 'ghost' : ''}" data-auth="${p.id}">כתב הסמכה${authStatus(p) === 'signed' ? ' ✓ נחתם' : authStatus(p) === 'partial' ? ' · חסרה חתימה' : ' · לחתימה'}</button>` : ''}${canManage(s, p.role) ? `<button class="btn small ghost" data-edit="${p.id}">עריכה</button>` : ''}</div></div>`).join('')}
    ${missing.map(([r]) => `<div class="prow need"><div><b>${ROLES[r]}</b> <span class="chip red">חסר</span><div class="small mut">${esc(WHY[r] || '')}</div></div><div></div>
      <div class="actions">${canManage(s, r) ? `<button class="btn small" data-fill="${r}">השלמה</button>` : `<span class="small mut">ממנה ${SIDE_OF_ROLE[r] === 'dev' ? 'היזם' : 'הקבלן הראשי'}</span>`}</div></div>`).join('')}
    ${!all.length && !missing.length ? '<div class="empty">עוד לא הוגדרו בעלי תפקידים</div>' : ''}</div></div></div>`);
  $$('[data-fill]', el).forEach(b => b.onclick = () => personForm(s, null, b.dataset.fill));
  $('[data-add]', el)?.addEventListener('click', () => personForm(s));
  $$('[data-edit]', el).forEach(b => b.onclick = () => personForm(s, all.find(p => p.id === b.dataset.edit)));
  $$('[data-auth]', el).forEach(b => b.onclick = () => openAuthSign(s, all.find(p => p.id === b.dataset.auth)));
  return el;
}

async function personForm(s, p = null, preset = null) {
  // רק תפקידים שהתקנות דורשות (בלי "קבלן משנה" ו"צופה")
  const allowed = Object.fromEntries(Object.entries(ROLES).filter(([r]) => (ASSIGNABLE.includes(r) && canManage(s, r)) || p?.role === r));
  const v = await modal({ title: p ? 'עריכת בעל תפקיד' : 'הוספת בעל תפקיד', ok: 'שמירה',
    body: `${select('תפקיד', 'role', allowed, p?.role || preset || Object.keys(allowed)[0])}
      ${field('שם מלא', 'name', p?.name || '', { req: true })}
      <div class="grid g2">${field('טלפון נייד (ל-WhatsApp)', 'phone', p?.phone || '', { type: 'tel', attrs: 'dir="ltr"' })}${field('אימייל', 'email', p?.email || '', { type: 'email', attrs: 'dir="ltr"' })}</div>
      ${field('רישיון / מספר רישום / הכשרה', 'license', p?.license || '', { hint: 'מהנדס: פנקס המהנדסים. מנהל עבודה: מרשם מנהלי עבודה. ממונה: תעודת ממונה. נציג מבצע הבנייה: הכשרה אם יש (למשל קורס מנהלי עבודה). הדין לא מחייב הכשרה, אבל מומלץ.' })}
      <div class="grid g2">${field('מתאריך', 'from_date', p?.from_date || new Date().toISOString().slice(0, 10), { type: 'date' })}${field('עד תאריך', 'to_date', p?.to_date || '', { type: 'date' })}</div>
      <label class="chk"><input type="checkbox" name="backup" ${p?.backup ? 'checked' : ''}> מחליף (מקבל התראה כשהאחראי לא טיפל)</label>
      <label class="chk"><input type="checkbox" name="active" ${p?.active === false ? '' : 'checked'}> פעיל באתר</label>
      ${p && p.active !== false ? '<p class="small mut">סיום כהונה של בקר, מנהל עבודה או מנהל אתר: מבטלים את "פעיל" ומדווחים אירוע, כדי שייפתחו חובות ההודעה והמינוי מחדש.</p>' : ''}`,
    validate: (d, form) => {
      if (!d.name?.trim()) return 'צריך שם';
      if (!d.phone?.trim() && !d.email?.trim()) return 'צריך טלפון או אימייל, כדי שאפשר יהיה לשלוח התראות';
      const me = { name: d.name, phone: d.phone, email: d.email };
      const others = S.data.site_people.filter(x => x.site_id === s.id && x.id !== p?.id && x.active !== false);
      const clash = others.find(x => (CONFLICT[d.role] || []).includes(x.role) && sameP(me, x));
      if (clash && form.active.checked) return `לא ניתן: ${clash.name} כבר ${ROLES[clash.role]} באתר. התקנות אוסרות לכהן בשני התפקידים (תקנות 2א(א)(2), 2ב(א)(2)).`;
      return null;
    } });
  if (!v) return;
  const row = { site_id: s.id, role: v.role, name: v.name.trim(), phone: v.phone.trim(), email: v.email.trim().toLowerCase(), license: v.license.trim(),
    from_date: v.from_date || null, to_date: v.to_date || null, backup: v.backup === 'on' || v.backup === true, active: v.active === 'on' || v.active === true };
  try {
    if (p) {
      const wasActive = p.active !== false;
      const r = await db.update('site_people', p.id, row); Object.assign(p, r);
      // סיום כהונה: מציעים לדווח אירוע שפותח את חובות ההודעה
      const evType = { bakar: 'bakar_left', wm: 'wm_left', sm: 'smgr_left', rep: 'wm_left' }[p.role];
      if (wasActive && !row.active && evType && !row.backup) {
        const ok = await modal({ title: 'דיווח סיום כהונה', ok: 'דיווח', cancel: 'לא עכשיו',
          body: `<p>${esc(p.name)} סיים/ה כהונה כ${ROLES[p.role]}. לדווח אירוע "${esc(EVENTS[evType].label)}"? הדיווח פותח את חובות ההודעה והמינוי מחדש לפי התקנות.</p>` });
        if (ok) await reportEvent(s, { type: evType, occurred_at: new Date().toISOString(), description: `${p.name} סיים/ה כהונה` });
      }
    } else S.data.site_people.push(...await db.insert('site_people', row));
    toast('נשמר'); render();
  } catch (e) { toast(e.message, 'bad'); }
}

// ===== פנקס כללי: רישומי בדיקות, צ'ק-אין, מינויים ודיווחים (תקנה 2(ט)) =====
function logItems(s) {
  return [
    ...checkinsFor(s.id).map(c => ({ at: c.at, kind: "צ'ק-אין והשגחה באתר", who: `${c.person_name}${c.role === 'rep' ? ' · נציג מבצע הבנייה, מטעם מבצע הבנייה' : ' · ' + (ROLES[c.role] || '')}${c.backup ? ' (ממלא מקום)' : ''}`,
      text: [c.note, ...Object.values(c.checks || {}).map(k => `${k.title}: ${k.ok ? 'תקין' : 'ליקויים. ' + k.note}`)].filter(Boolean).join('\n'), geo: c.lat ? `${c.lat}, ${c.lng}` : '' })),
    ...S.data.duties.filter(d => d.site_id === s.id && d.status === 'done' && d.key !== 'daily_checkin').map(d => ({ at: d.done_at, kind: d.title, who: d.done_by || '', text: [d.evidence_note, d.evidence_ref].filter(Boolean).join(' · '), ref: d.ref })),
    ...S.data.events.filter(e => e.site_id === s.id).map(e => ({ at: e.occurred_at, kind: 'אירוע: ' + (EVENTS[e.type]?.label || e.type), who: e.reported_by || '', text: e.description || '' })),
    ...(canSeeWorkers(s.id) ? (S.data.trainings || []).filter(t => t.site_id === s.id && sigsOfTraining(t.id).length).map(t => ({ at: t.held_at, kind: 'הדרכה: ' + TRAINING_KINDS[t.kind],
      who: `${t.trainer_name}${t.trainer_title ? ' · ' + t.trainer_title : ''}`, text: `${t.topic}\nחתמו ${sigsOfTraining(t.id).length} עובדים: ${sigsOfTraining(t.id).map(g => g.worker_name).join(', ')}${t.closed_at ? '' : '\n(ההדרכה עוד פתוחה לחתימות)'}` })) : []),
    ...(S.data.inspections || []).filter(r => r.site_id === s.id).map(r => { const e = equipmentOf(s.id).find(x => x.id === r.equipment_id); return { at: r.inspected_at, kind: 'תסקיר: ' + (e?.name || '') + (e?.ident ? ' ' + e.ident : ''),
      who: r.inspector, text: `בתוקף עד ${fmtDate(r.next_due)}${r.note ? '\n' + r.note : ''}` }; }),
    ...(S.data.site_inspections || []).filter(x => x.site_id === s.id).map(x => ({ at: x.started_at, kind: 'ביקורת באתר: ' + x.inspector_name, who: x.started_by_email || '',
      text: [x.purpose, (x.notified || []).length ? 'הודעה נשלחה אל: ' + [...new Set(x.notified.map(n => n.name))].join(', ') : ''].filter(Boolean).join('\n') })),
    ...(canSeeWorkers(s.id) ? Object.entries((S.data.attendance || []).filter(a => a.site_id === s.id && a.present).reduce((m, a) => { (m[a.day] ||= []).push(a.worker_id); return m; }, {}))
      .map(([day, ids]) => ({ at: day + 'T06:00:00', kind: `נוכחות: ${ids.length} עובדים באתר`, who: '', text: ids.map(id => (S.data.workers || []).find(w => w.id === id)?.name || '').filter(Boolean).join(', ') })) : []),
    ...(S.data.notices || []).filter(n => n.site_id === s.id && n.status === 'sent').map(n => ({ at: n.sent_at, kind: 'הודעה רשמית: ' + n.title, who: `${n.sent_by || ''} · אושרה בידי ${n.approved_by || ''}`,
      text: [n.channel === 'email' ? 'אל: ' + (n.to_list || []).map(p => p.name).join(', ') : '', n.sent_ref ? 'אסמכתה: ' + n.sent_ref : '', n.channel === 'gov' ? (n.fields || []).map(([k, v]) => k + ': ' + (v || '')).join('\n') : n.body].filter(Boolean).join('\n') })),
    ...defectsOf(s.id).flatMap(d => [{ at: d.created_at, kind: 'ליקוי בטיחות: ' + d.title, who: d.created_by_email || '', text: [d.location, SEV[d.severity]?.[1], 'אחראי: ' + (d.responsible || ''), 'לתקן עד ' + fmtDate(d.due_date)].filter(Boolean).join(' · ') },
      ...(d.closed_at ? [{ at: d.closed_at, kind: 'ליקוי תוקן: ' + d.title, who: d.closed_by_email || '', text: d.fix_note || '' }] : [])])
  ].sort((a, b) => String(b.at).localeCompare(String(a.at)));
}
function tabLog(s) {
  const items = logItems(s);
  const el = h(`<div class="card"><div class="dh"><h2>פנקס כללי</h2><button class="btn small ghost" data-print>הדפסה</button></div>
    <p class="small mut">כל רישום שהתקנות מחייבות: צ'ק-אין יומי וביקורות היום, בדיקות, מינויים, דיווחים, אירועים וליקויים. רישום של נציג מבצע הבנייה מסומן "מטעם מבצע הבנייה". המזמין רואה את הפנקס. אין מחיקה ואין עריכה.</p>
    <div class="banner">הפנקס הכללי נשמר בטופס שנקבע (סעיף 198 לפקודת הבטיחות בעבודה וצו הבטיחות בעבודה (פנקס כללי), תש"ך-1959). לא מצאנו הוראה שמתירה פנקס דיגיטלי בלבד, ולכן הפנקס המודפס נשאר באתר. מכאן מפיקים דפים מוכנים לצירוף לפנקס.<div class="actions"><button class="btn small" data-pages>📄 דפים לצירוף לפנקס (PDF)</button></div></div>
    <div class="log">${items.map(x => `<div class="lrow"><div class="small mut">${fmtDT(x.at)}</div><div><b>${esc(x.kind)}</b><div class="small">${esc(x.who)}</div>${x.text ? `<div class="small pre">${esc(x.text)}</div>` : ''}${x.geo ? `<div class="small mut">מיקום: ${esc(x.geo)}</div>` : ''}${x.ref ? `<div class="small mut">§ ${esc(x.ref)}</div>` : ''}</div></div>`).join('') || '<div class="empty">אין רישומים עדיין</div>'}</div></div>`);
  $('[data-print]', el).onclick = () => window.print();
  $('[data-pages]', el).onclick = () => logPages(s);
  return el;
}
// דפים לצירוף לפנקס הכללי המודפס, לפי טווח תאריכים
async function logPages(s) {
  const iso = d => d.toISOString().slice(0, 10);
  const v = await modal({ title: 'דפים לצירוף לפנקס הכללי', ok: 'הפקת PDF',
    body: `<div class="grid g2">${field('מתאריך', 'from', iso(new Date(Date.now() - 7 * 864e5)), { type: 'date', req: true })}${field('עד תאריך', 'to', iso(new Date()), { type: 'date', req: true })}</div>
      <p class="small mut">מדפיסים, חותמים ומצרפים לפנקס הכללי שבאתר.</p>`,
    validate: d => !d.from || !d.to ? 'צריך טווח תאריכים' : d.from > d.to ? 'תאריך ההתחלה אחרי תאריך הסיום' : null });
  if (!v) return;
  const win = window.open('', '_blank');
  try {
    const rows = logItems(s).filter(x => x.at && String(x.at).slice(0, 10) >= v.from && String(x.at).slice(0, 10) <= v.to).reverse();
    const con = conNames(s.id).join(', ');
    const blocks = [
      { type: 'title', text: 'רישומים לצירוף לפנקס הכללי', brand: 'צי הנדסה', sub: `${s.name}${s.address ? ', ' + s.address : ''} · ${fmtDate(v.from)} עד ${fmtDate(v.to)}` },
      { type: 'kv', rows: [['מבצע הבנייה', con || '—'], ['מספר רישומים', String(rows.length)]] },
      { type: 'table', cols: [{ h: 'מועד', w: 0.15 }, { h: 'רישום', w: 0.27 }, { h: 'מי', w: 0.18 }, { h: 'פרטים', w: 0.4 }],
        rows: rows.map(x => [fmtDT(x.at), x.kind, x.who || '', [x.text, x.ref ? '§ ' + x.ref : ''].filter(Boolean).join('\n')]) },
      { type: 'p', size: 20, bold: true, color: '#111', text: 'שם וחתימת מנהל העבודה: ____________________    תאריך: __________' },
      { type: 'p', size: 16, color: '#666', text: `הופק ${fmtDT(new Date().toISOString())} ממערכת ניהול הבטיחות של צי הנדסה. העתק זה מצורף לפנקס הכללי המודפס שבאתר.` }];
    const blob = await pagesToPdf(await renderPdfPages(blocks, `${s.name} · פנקס כללי`));
    const u = URL.createObjectURL(blob);
    if (win && win.location) win.location.href = u; else window.open(u, '_blank');
  } catch (e) { win?.close?.(); toast(e.message, 'bad'); }
}

// ===== יומן ביקורת =====
const TBL = { sites: 'אתר', site_people: 'בעל תפקיד', duties: 'חובה', events: 'אירוע', site_orgs: 'שיוך ארגון', orgs: 'ארגון', memberships: 'משתמש' };
const ACT = { insert: 'יצירה', update: 'עדכון', delete: 'מחיקה' };
function tabAudit(s) {
  const el = h('<div class="card"><h2>יומן ביקורת</h2><p class="small mut">כל שינוי נרשם עם מי ומתי. אי אפשר למחוק או לשנות את היומן.</p><div id="al" class="small">טוען…</div></div>');
  el.addEventListener('mounted', async () => {
    try {
      const rows = (await db.select('audit_log', { eq: { site_id: s.id }, order: 'at desc' })).slice(0, 300);
      $('#al', el).innerHTML = rows.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>מתי</th><th>מי</th><th>מה</th><th>פרטים</th></tr></thead><tbody>${rows.map(r => {
        const n = r.new_data || r.old_data || {};
        const what = n.title || n.name || EVENTS[n.type]?.label || '';
        const ch = r.action === 'update' && r.old_data && r.new_data ? Object.keys(r.new_data).filter(k => !['updated_at'].includes(k) && JSON.stringify(r.new_data[k]) !== JSON.stringify(r.old_data[k])).map(k => k === 'status' ? `סטטוס: ${r.old_data[k]} ← ${r.new_data[k]}` : k).join(', ') : '';
        return `<tr><td>${fmtDT(r.at)}</td><td>${esc(r.user_email || '')}</td><td>${ACT[r.action] || r.action} ${TBL[r.table_name] || r.table_name}</td><td>${esc(what)}${ch ? `<div class="mut">${esc(ch)}</div>` : ''}</td></tr>`;
      }).join('')}</tbody></table></div>` : '<div class="empty">אין רשומות</div>';
    } catch (e) { $('#al', el).textContent = e.message; }
  });
  return el;
}
