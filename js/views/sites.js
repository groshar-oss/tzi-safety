// רשימת אתרים ואשף התחולה (אתר חדש / עריכת פרופיל משפטי)
import { db } from '../db.js';
import { S, visibleSites, isAdmin, myRoles, siteById, syncSite, render, hasRole } from '../app.js';
import { WORK_TYPES, STAGES, ACTIVITIES, profileNotes, derive, sync, CAT, clientSummary, CLIENT_KINDS } from '../duties.js';
import { esc, h, $, $$, toast, field, select, modal } from '../util.js';
import { siteCard } from './home.js';

export function viewSites() {
  const sites = visibleSites();
  const canNew = isAdmin() || S.data.sites.some(s => myRoles(s.id).includes('dev')) || S.ctx.demoRole === 'dev';
  return h(`<div><div class="top"><div><h1>אתרים</h1><div class="sub">${sites.length} אתרים</div></div>
    <div class="actions">${canNew ? '<a class="btn" href="#/new-site">אתר חדש</a>' : ''}</div></div>
    <div class="sgrid">${sites.map(siteCard).join('') || '<div class="card empty">אין אתרים עדיין</div>'}</div></div>`);
}

const yn = (label, name, val, hint = '') => `<label class="chk q"><input type="checkbox" name="${name}" ${val ? 'checked' : ''}><span>${esc(label)}${hint ? `<small>${esc(hint)}</small>` : ''}</span></label>`;

// אשף: שאלות שקובעות אילו חובות חלות. siteId = עריכה של אתר קיים
export function viewNewSite(siteId) {
  const site = siteId ? siteById(siteId) : null;
  if (siteId && !site) return h('<div class="card empty">האתר לא נמצא</div>');
  if (site && !hasRole(site.id, 'dev')) return h('<div class="card empty">רק נציג היזם או מנהלת השירות יכולים לשנות את הפרופיל המשפטי.</div>');
  const p = site?.profile || { work_type: 'new', permit_required: true, contractors: 1, stages: {} };
  const orgs = S.data.orgs;
  const devs = Object.fromEntries([['', 'בחירה…'], ...orgs.filter(o => o.kind === 'developer').map(o => [o.id, o.name])]);
  const cons = orgs.filter(o => o.kind === 'contractor');
  const linked = site ? S.data.site_orgs.filter(x => x.site_id === site.id) : [];
  const el = h(`<div><div class="top"><div><h1>${site ? 'פרופיל משפטי: ' + esc(site.name) : 'אתר חדש'}</h1><div class="sub">התשובות קובעות אילו חובות חלות על האתר, על היזם ועל הקבלן הראשי</div></div></div>
    <form id="wz" class="cols" novalidate>
      <div>
        <div class="card"><h2>1. פרטי האתר</h2>
          ${field('שם האתר', 'name', site?.name || '', { req: true })}
          ${field('כתובת', 'address', site?.address || '')}
          <div class="grid g2">${select('יזם (המזמין)', 'dev_org', devs, linked.find(x => x.kind === 'developer')?.org_id || '')}
            <label class="fld"><span>קבלנים ראשיים</span><div class="mchk">${cons.map(o => `<label class="chk"><input type="checkbox" name="con_${o.id}" ${linked.some(x => x.org_id === o.id) ? 'checked' : ''}>${esc(o.name)}</label>`).join('') || '<span class="mut small">אין קבלנים. מוסיפים במסך ארגונים.</span>'}</div></label></div>
        </div>
        <div class="card"><h2>2. סוג העבודה והיתר</h2>
          ${select('סוג העבודה', 'work_type', WORK_TYPES, p.work_type)}
          ${yn('העבודה טעונה היתר בנייה', 'permit_required', p.permit_required, 'אם כן, המזמין הוא בעל ההיתר. אם לא, בעל הנכס.')}
          <div class="grid g2">${field('מספר היתר', 'permit_no', p.permit_no || '')}${field('בעל ההיתר / בעל הנכס', 'owner', p.owner || '')}</div>
          ${select('מי המזמין (מי שהתקשר עם הקבלן)', 'client_kind', CLIENT_KINDS, p.client_kind || '')}
          <div id="existingQ">
            ${yn('המבנה קיבל תעודת גמר (עבודה במבנה קיים)', 'completion_cert', p.completion_cert)}
            ${yn('נדרש אישור מהנדס רשוי לפי סעיף 12 לחוק המהנדסים והאדריכלים', 'engineer_needed', p.engineer_needed, 'למשל שינוי בקונסטרוקציה. אם לא נדרש, זו עבודה מסוג 2(ז)(1).')}
          </div>
          ${yn('העבודה פטורה מהיתר בנייה', 'permit_exempt', p.permit_exempt)}
          ${yn('עבודת בנייה עצמית', 'self_build', p.self_build, 'בית צמוד קרקע שאינו בנייה רוויה, או שיפוץ למגורים ביוזמת יחיד שלא במסגרת עסק. מומלץ לאשר מול יועץ.')}
          <div id="client2"></div>
        </div>
        <div class="card"><h2>3. היקף</h2>
          <div class="grid g3">${field('שטח לפי ההיתר (מ"ר)', 'area', p.area || '', { type: 'number' })}${field('מספר עובדים מרבי בו-זמנית (כולל קבלני משנה)', 'workers_max', p.workers_max || '', { type: 'number' })}${field('משך צפוי (שבועות)', 'duration_weeks', p.duration_weeks || '', { type: 'number' })}</div>
          <div class="grid g2">${field('מועד התחלה (מתוכנן או בפועל)', 'start_date', p.start_date || '', { type: 'date', req: true })}${field('מספר קבלנים ראשיים', 'contractors', p.contractors || 1, { type: 'number' })}</div>
          ${yn('אחד הקבלנים הראשיים קיבל בכתב אחריות כוללת של מבצע בנייה והודיע למפקח (תקנה 6(ד))', 'single_responsible', p.single_responsible)}
          ${yn('יועסקו עובדים זרים בענף הבניין', 'foreign_workers', p.foreign_workers)}
          ${yn('יהיו פיגומים באתר', 'scaffolds', p.scaffolds)}
          ${yn('האתר היה פעיל לפני 16.10.2026', 'active_before', p.active_before)}
        </div>
        <div class="card"><h2>4. עבודות באתר וימי עבודה</h2><p class="small mut">העבודות האלה מוסיפות חובות של מנהל העבודה (או של נציג מבצע הבנייה, כשאין מנהל עבודה).</p>
          ${Object.entries(ACTIVITIES).map(([k, [a, b]]) => yn(a, 'act_' + k, p.activities?.[k], b)).join('')}
          <label class="fld"><span>ימי עבודה (לצ'ק-אין היומי)</span><div class="days">${['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'].map((n, i) => `<label class="chk"><input type="checkbox" name="wd_${i}" ${(p.work_days || [0, 1, 2, 3, 4]).map(Number).includes(i) ? 'checked' : ''}>${n}</label>`).join('')}</div></label>
          ${field("צ'ק-אין עד השעה", 'checkin_by', p.checkin_by || '09:00', { type: 'time' })}</div>
        <div class="card"><h2>5. שלבי בנייה (לתזמון ביקורי הבקר)</h2><p class="small mut">תאריך התחלה לכל שלב שמבוצע באתר. השאירו ריק אם השלב לא מבוצע.</p>
          <div class="grid g4">${Object.entries(STAGES).map(([k, v]) => field(v, 'st_' + k, p.stages?.[k] || '', { type: 'date' })).join('')}</div></div>
      </div>
      <div><div class="card sticky"><h2>מה חל על האתר</h2><div id="client"></div><div id="notes"></div><div id="diff"></div>
        <div class="err" id="werr" hidden></div>
        <div class="actions"><button class="btn" type="submit">${site ? 'שמירת הפרופיל' : 'יצירת האתר'}</button><a class="btn ghost" href="${site ? '#/site/' + site.id : '#/sites'}">ביטול</a></div>
        <p class="small mut">הקביעה מבוססת על התשובות. במקרה ספק, יש לאשר מול יועץ בטיחות או עו"ד.</p></div></div>
    </form></div>`);
  const form = $('#wz', el);
  const read = () => {
    const f = form.elements, v = n => f[n]?.value, c = n => !!f[n]?.checked;
    return {
      name: v('name').trim(), address: v('address').trim(), dev_org: v('dev_org'), cons: cons.filter(o => c('con_' + o.id)).map(o => o.id),
      profile: { work_type: v('work_type'), permit_required: c('permit_required'), permit_no: v('permit_no'), owner: v('owner'), client_kind: v('client_kind') || '', completion_cert: c('completion_cert'), engineer_needed: c('engineer_needed'),
        permit_exempt: c('permit_exempt'), self_build: c('self_build'), area: +v('area') || 0, workers_max: +v('workers_max') || 0, duration_weeks: +v('duration_weeks') || 0,
        start_date: v('start_date'), contractors: Math.max(1, +v('contractors') || 1), single_responsible: c('single_responsible'), foreign_workers: c('foreign_workers'), scaffolds: c('scaffolds'),
        active_before: c('active_before'), activities: Object.fromEntries(Object.keys(ACTIVITIES).map(k => [k, c('act_' + k)]).filter(([, x]) => x)),
        work_days: [0, 1, 2, 3, 4, 5, 6].filter(i => c('wd_' + i)), checkin_by: v('checkin_by') || '09:00', stages: Object.fromEntries(Object.keys(STAGES).map(k => [k, v('st_' + k)]).filter(([, x]) => x)) }
    };
  };
  const refresh = () => {
    const r = read();
    $('#existingQ', el).hidden = !['fitout', 'renovation'].includes(r.profile.work_type);
    const cs = clientSummary(r.profile);
    const line = `<div class="clientline ${cs.need ? 'need' : 'free'}"><b>מזמין ובקר בטיחות:</b> ${esc(cs.text)}</div>`;
    $('#client2', el).innerHTML = line;
    $('#client', el).innerHTML = line + (site && site.status === 'active' && cs.need && !derive(site.profile || {}).clientDuties ? '<div class="banner crit">האתר כבר בעבודה: בשמירה ייפתחו מיד חובות המזמין והבקר, עם התראה קריטית למזמין, לקבלן ולמנהל המערכת.</div>' : '');
    $('#notes', el).innerHTML = profileNotes(r.profile).slice(1).map(([k, t]) => `<div class="pn ${k}">${k === 'ok' ? '✓' : k === 'warn' ? '!' : '–'} ${esc(t)}</div>`).join('');
    if (site) { // מה ישתנה בחובות
      const { add, upd } = sync({ ...site, profile: r.profile }, S.data.duties.filter(d => d.site_id === site.id));
      const na = upd.filter(u => u.status === 'na').map(u => S.data.duties.find(d => d.id === u.id)?.title);
      $('#diff', el).innerHTML = add.length || na.length ? `<div class="note">${add.length ? '<b>יתווספו:</b><br>' + add.map(a => '• ' + esc(a.title)).join('<br>') : ''}${na.length ? '<br><b>יסומנו "לא חל":</b><br>' + na.map(t => '• ' + esc(t)).join('<br>') : ''}</div>` : '';
    }
  };
  form.addEventListener('input', refresh); form.addEventListener('change', refresh);
  el.addEventListener('mounted', refresh);
  form.onsubmit = async e => {
    e.preventDefault();
    const err = m => { const x = $('#werr', el); x.textContent = m; x.hidden = !m; if (m) { toast(m, 'bad'); x.scrollIntoView({ block: 'center', behavior: 'smooth' }); } };
    let r; try { r = read(); } catch (x) { return err('שגיאה בקריאת הטופס: ' + x.message); }
    if (!r.name) return err('צריך שם לאתר');
    if (!r.profile.start_date) return err('צריך מועד התחלה');
    if (r.cons.length > 1 && r.profile.contractors < r.cons.length) r.profile.contractors = r.cons.length;
    try {
      let s;
      const flipped = site && site.status === 'active' && !derive(site.profile || {}).clientDuties && derive(r.profile).clientDuties;
      if (site) { s = await db.update('sites', site.id, { name: r.name, address: r.address, profile: r.profile }); Object.assign(site, s); s = site; }
      else { [s] = await db.insert('sites', { name: r.name, address: r.address, profile: r.profile, status: r.profile.active_before ? 'active' : 'planning' }); S.data.sites.push(s); }
      // שיוך ארגונים
      const want = [...(r.dev_org ? [[r.dev_org, 'developer']] : []), ...r.cons.map(id => [id, 'contractor'])];
      const cur = S.data.site_orgs.filter(x => x.site_id === s.id);
      for (const [org_id, kind] of want) if (!cur.some(x => x.org_id === org_id)) S.data.site_orgs.push(...await db.insert('site_orgs', { site_id: s.id, org_id, kind }));
      for (const x of cur) if (!want.some(([id]) => id === x.org_id)) { await db.remove('site_orgs', x.id); S.data.site_orgs = S.data.site_orgs.filter(y => y.id !== x.id); }
      await syncSite(s, false);
      toast(flipped ? 'נפתחו חובות המזמין ומינוי בקר הבטיחות, כהתראה קריטית.' : site ? 'הפרופיל עודכן והחובות חושבו מחדש' : 'האתר נוצר. עכשיו מוסיפים בעלי תפקידים.', flipped ? 'bad' : undefined);
      location.hash = site ? `#/site/${s.id}` : `#/site/${s.id}/people`;
      render();
    } catch (x) { err(x.message); }
  };
  void $$; void derive; void CAT; void modal;
  return el;
}
