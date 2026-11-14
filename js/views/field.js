// מסך שטח לטלפון ("היום באתר"): למנהל העבודה ולנציג מבצע הבנייה. רק מה שצריך היום, עם כפתורים גדולים
import { S, visibleSites, myRoles, isAdmin } from '../app.js';
import { exceptions } from '../alerts.js';
import { esc, h, $, $$ } from '../util.js';
import { dutyCard } from './common.js';
import { checkinCard } from './checkin.js';
import { workersOf, workerStatus, equipmentOf, lastInspection, isPresent } from '../workers.js';
import { canRegister, workerForm, newTraining, canSeeWorkers } from './workers.js';
import { canInspect } from './inspect.js';
import { canEquip, dailyCheck, checkedToday } from './equipment.js';
import { eventFormFor, hcBanner, defCard } from './site.js';
import { defectForm, canAddDefect } from './defects.js';
import { store } from '../util.js';

const FIELD = ['wm', 'rep', 'so', 'fa'];
// משתמש שטח: כל התפקידים שלו באתרים הם תפקידי שטח (מנהל עבודה, נציג, עזרה ראשונה)
export function isFieldUser() {
  if (!S.ctx || isAdmin()) return false;
  const roles = visibleSites().flatMap(s => myRoles(s.id));
  return roles.length > 0 && roles.every(r => FIELD.includes(r)) && roles.some(r => r === 'wm' || r === 'rep' || r === 'so');
}
const fieldSites = () => visibleSites().filter(s => !['done', 'closed_order'].includes(s.status) && myRoles(s.id).some(r => ['admin', 'con', 'wm', 'rep', 'so'].includes(r)));

export function viewField(siteId) {
  const sites = fieldSites();
  if (!sites.length) return h('<div class="card empty">אין אתר פעיל שבו יש לך תפקיד בשטח</div>');
  const saved = store('safety-field-site');
  const s = sites.find(x => x.id === siteId) || sites.find(x => x.id === saved) || sites[0];
  store('safety-field-site', s.id);
  const mine = myRoles(s.id);
  const all = mine.includes('admin') || mine.includes('con');
  const todo = exceptions(S.data, [s]).filter(x => x.duty.key !== 'daily_checkin' && ['crit', 'red', 'warn'].includes(x.level) && x.duty.side === 'con'
    && (all || x.roles.some(r => mine.includes(r))));
  const ws = workersOf(s.id).filter(w => w.active !== false).map(w => ({ w, st: workerStatus(w) }));
  const blocked = ws.filter(x => x.st.lv === 'bad'), soon = ws.filter(x => x.st.lv === 'warn');
  const eqBad = equipmentOf(s.id).filter(e => e.active !== false).filter(e => { const li = lastInspection(e.id); return !li || new Date(li.next_due + 'T23:59:59') < Date.now() + 30 * 864e5; });
  const reg = canRegister(s.id);
  const eqAll = equipmentOf(s.id).filter(e => e.active !== false);
  const eqStop = eqAll.filter(e => e.stop_use), eqTodo = eqAll.filter(e => !checkedToday(e));
  const el = h(`<div class="field">
    ${sites.length > 1 ? `<div class="chips">${sites.map(x => `<a class="chip ${x.id === s.id ? 'on' : ''}" href="#/field/${x.id}">${esc(x.name)}</a>`).join('')}</div>` : ''}
    <h1>${esc(s.name)}</h1><div class="sub">${esc(s.address || '')} · ${new Date().toLocaleDateString('he-IL', { weekday: 'long', day: '2-digit', month: '2-digit' })}</div>
    ${checkinCard(s)}
    ${hcBanner(s)}
    <div class="bigbtns">
      ${reg ? `<a class="bb" href="#/site/${s.id}/workers/attendance"><span>☑</span>נוכחות היום <small>${ws.filter(x => isPresent(x.w.id)).length} באתר</small></a><button class="bb" data-newtr><span>✍</span>הדרכה חדשה</button><button class="bb" data-neww><span>＋</span>עובד חדש</button>` : ''}
      ${canInspect(s.id) ? `<a class="bb" href="#/site/${s.id}/inspect"><span>🔍</span>ביקורת באתר</a>` : ''}
      ${canEquip(s.id) && eqAll.length ? `<button class="bb" data-daily><span>🏗</span>בדיקה יומית לציוד <small>${eqTodo.length ? eqTodo.length + ' לא נבדקו היום' : 'הכול נבדק היום ✓'}</small></button>` : ''}
      ${canAddDefect(s.id) ? '<button class="bb" data-def><span>📷</span>ליקוי בטיחות</button>' : ''}
      <button class="bb danger" data-risk><span>⚠</span>דיווח סיכון</button>
    </div>
    <div class="card"><h2>לעשות היום <span class="mut small">${todo.length}</span></h2>
      ${todo.map(x => dutyCard(x.duty)).join('') || '<div class="empty">אין משימות פתוחות להיום 👍</div>'}</div>
    ${ws.length || reg ? `<a class="card fsum" href="#/site/${s.id}/workers"><h2>עובדים <span class="mut small">${ws.length}${canSeeWorkers(s.id) ? ` · באתר היום ${ws.filter(x => isPresent(x.w.id)).length}` : ''}</span></h2>
      <div>${blocked.length ? `<span class="chip red">${blocked.length} אסור להעסיק</span>` : ''}${soon.length ? `<span class="chip amber">${soon.length} פג בקרוב</span>` : ''}${!blocked.length && !soon.length ? '<span class="chip green">כולם בסדר</span>' : ''}</div>
      ${blocked.slice(0, 6).map(x => `<div class="small neg">${esc(x.w.name)}: ${esc(x.st.issues[0] || '')}</div>`).join('')}</a>` : ''}
    ${defCard(s)}
    ${eqBad.length || eqStop.length ? `<a class="card fsum" href="#/site/${s.id}/equipment"><h2>ציוד</h2>${eqStop.map(e => `<div class="small neg">⛔ ${esc(e.name)}: אסור להפעיל עד שהליקוי מתוקן</div>`).join('')}${eqBad.map(e => `<div class="small">${esc(e.name)}: ${lastInspection(e.id) ? 'תסקיר פג או פג בקרוב' : 'אין תסקיר'}</div>`).join('')}</a>` : ''}
    <div class="flinks"><a href="#/site/${s.id}/recurring">משימות חוזרות</a><a href="#/site/${s.id}/log">פנקס כללי</a><a href="#/site/${s.id}">כל פרטי האתר</a></div>
  </div>`);
  $('[data-newtr]', el)?.addEventListener('click', () => newTraining(s));
  $('[data-neww]', el)?.addEventListener('click', () => workerForm(s));
  $('[data-def]', el)?.addEventListener('click', () => defectForm(s));
  $('[data-daily]', el)?.addEventListener('click', () => dailyCheck(s));
  $('[data-risk]', el)?.addEventListener('click', () => eventFormFor(s, 'unacceptable'));
  void $$;
  return el;
}
