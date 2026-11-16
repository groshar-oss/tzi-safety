// מסך הבית: מה דורש טיפול, לפי התפקיד
import { S, visibleSites, myRoles, isAdmin, sideOf } from '../app.js';
import { exceptions } from '../alerts.js';
import { derive, gateStatus, ROLES } from '../duties.js';
import { esc, h } from '../util.js';
import { dutyCard, compliance, gauge, chip } from './common.js';
import { checkinCard } from './checkin.js';
import { pendingBanner, wirePending } from './invite.js';

const STATUS = { planning: 'לפני התחלה', approved: 'אושר להתחלה', active: 'פעיל', stopped: 'מושבת', closed_order: 'סגור בצו', done: 'הסתיים' };
export const statusName = s => STATUS[s] || s || '';

export function siteCard(s) {
  const c = compliance(s.id);
  const ex = exceptions(S.data, [s]);
  const n = lv => ex.filter(x => x.level === lv).length;
  const g = gateStatus(S.data.duties.filter(d => d.site_id === s.id));
  const hasBakar = S.data.site_people.some(p => p.site_id === s.id && p.role === 'bakar' && p.active !== false);
  const d = derive(s.profile);
  return `<a class="proj site" href="#/site/${s.id}" style="border-inline-start-color:${c.pct >= 95 ? '#2fb36b' : c.pct >= 80 ? '#e08a00' : '#c62828'}">
    <div class="hd"><span>${esc(s.name)}</span><span class="chip">${esc(statusName(s.status))}</span></div>
    <div class="meta">${esc(s.address || '')}</div>
    <div class="srow">${gauge(c)}
      <div class="cnt">${n('crit') ? `<span class="chip red">⛔ ${n('crit')} קריטי</span>` : ''}${n('red') ? `<span class="chip red">${n('red')} חריגות</span>` : ''}${n('warn') ? `<span class="chip amber">${n('warn')} אזהרות</span>` : ''}${!n('crit') && !n('red') && !n('warn') ? '<span class="chip green">אין חריגות פתוחות</span>' : ''}</div></div>
    ${s.status === 'planning' && d.clientDuties ? `<div class="small mut">שער התחלה: ${g.items.length - g.missing.length} מתוך ${g.items.length} תנאים</div>` : ''}
    ${d.clientDuties && !hasBakar ? '<div class="dn">אין בקר בטיחות ממונה: חובות הבקר חלות על היזם</div>' : ''}
  </a>`;
}

export function viewHome() {
  const sites = visibleSites();
  const ex = exceptions(S.data, sites);
  // "שלי": חריגות שהמשתמש אחראי להן (מנהלת שירות: כל הקריטיות והחריגות)
  const mine = ex.filter(x => isAdmin() ? ['crit', 'red'].includes(x.level) : x.roles.some(r => myRoles(x.site.id).includes(r)));
  const watch = ex.filter(x => !mine.includes(x) && ['crit', 'red'].includes(x.level));
  const k = lv => ex.filter(x => x.level === lv).length;
  const devSide = sites.some(s => sideOf(s.id) === 'dev');
  const actingBakar = sites.filter(s => derive(s.profile).clientDuties && !S.data.site_people.some(p => p.site_id === s.id && p.role === 'bakar' && p.active !== false));
  const el = h(`<div>
    <div class="top"><div><h1>מה דורש טיפול</h1><div class="sub">${sites.length} אתרים · ${ex.length} התראות פתוחות</div></div>
      <div class="actions"><a class="btn ghost" href="#/alerts">כל ההתראות</a>${isAdmin() || sites.some(s => myRoles(s.id).includes('dev')) ? '<a class="btn" href="#/new-site">אתר חדש</a>' : ''}</div></div>
    ${pendingBanner()}
    ${devSide && actingBakar.length ? `<div class="banner crit">⛔ ${actingBakar.map(s => esc(s.name)).join(', ')}: אין בקר בטיחות ממונה. כל עוד לא מונה, חובות הבקר חלות על היזם (תקנה 1א(ב)).</div>` : ''}
    ${sites.filter(s => myRoles(s.id).some(r => ['wm', 'rep', 'admin', 'con'].includes(r))).map(checkinCard).join('')}
    ${sites.filter(s => derive(s.profile).exempt27 && sideOf(s.id) !== 'dev' && !S.data.site_people.some(p => p.site_id === s.id && ['wm', 'rep'].includes(p.role) && p.active !== false)).map(s => `<div class="banner crit">⛔ ${esc(s.name)}: חובות מנהל העבודה חלות על מבצע הבנייה (תקנה 2(ז)), ואין באתר מי שמבצע אותן. <a href="#/site/${s.id}/people">רישום נציג</a></div>`).join('')}
    <div class="kpis">
      <div class="kpi"><div class="l">קריטי</div><div class="v" style="color:#7a0f0f">${k('crit')}</div><div class="n">דורש פעולה מיידית</div></div>
      <div class="kpi"><div class="l">חריגות</div><div class="v neg">${k('red')}</div><div class="n">מועד שעבר</div></div>
      <div class="kpi"><div class="l">אזהרות</div><div class="v" style="color:#e08a00">${k('warn')}</div><div class="n">מועד מתקרב</div></div>
      <div class="kpi"><div class="l">מידע</div><div class="v" style="color:var(--acc)">${k('info')}</div><div class="n">תזכורות</div></div>
    </div>
    <div class="cols">
      <div>
        <div class="card"><h2>דורש פעולה ממך <span class="mut small">${mine.length}</span></h2>
          ${mine.length ? mine.slice(0, 30).map(x => dutyCard(x.duty, { showSite: true })).join('') : '<div class="empty">אין פריטים פתוחים באחריותך 👍</div>'}</div>
        ${watch.length ? `<div class="card"><h2>חריגות של אחרים באתרים שלך <span class="mut small">${watch.length}</span></h2>${watch.slice(0, 20).map(x => dutyCard(x.duty, { showSite: true })).join('')}</div>` : ''}
      </div>
      <div><div class="card"><h2>אתרים</h2>${sites.map(siteCard).join('') || '<div class="empty">אין אתרים עדיין</div>'}</div>
        <div class="card small mut">התפקיד שלך: ${[...new Set(sites.flatMap(s => myRoles(s.id)))].map(r => r === 'admin' ? 'מנהל שירות' : ROLES[r]).join(', ') || '—'}</div></div>
    </div></div>`);
  void chip;
  wirePending(el);
  return el;
}
