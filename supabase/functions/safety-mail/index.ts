// שליחת המיילים של מערכת הבטיחות דרך Resend. מופעל כל 15 דקות מ-pg_cron (ראו supabase/mail.sql).
// סוד אחד ב-Edge Function Secrets: RESEND_API_KEY. הסיסמה של ה-cron וההפעלה נשמרות בטבלה mail_settings (רק השרת קורא אותה)
// @ts-nocheck
import { plan, israelNow } from './core.js';

const URL0 = Deno.env.get('SUPABASE_URL');
const KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const RESEND = Deno.env.get('RESEND_API_KEY');
const FROM = Deno.env.get('MAIL_FROM') || 'צי הנדסה · בטיחות <safety@tzi-eng.co.il>';
const REPLY_TO = Deno.env.get('MAIL_REPLY_TO') || '';
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

async function rest(path: string, init: RequestInit = {}) {
  const r = await fetch(`${URL0}/rest/v1/${path}`, { ...init, headers: { ...H, ...(init.headers || {}) } });
  if (!r.ok) throw new Error(`${path}: ${r.status} ${await r.text()}`);
  const t = await r.text(); return t ? JSON.parse(t) : null;
}
const all = async (t: string, q = '', cols = '*') => { const out = []; for (let o = 0; ; o += 1000) { const x = await rest(`${t}?select=${cols}${q}&limit=1000&offset=${o}`); out.push(...x); if (x.length < 1000) return out; } };
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function load() {
  // 70 יום אחורה: מספיק לשבוע האחרון ולדוח החודשי (החודש שעבר והחודש שלפניו)
  const since = new Date(Date.now() - 70 * 864e5).toISOString().slice(0, 10);
  const [sites, site_people, duties, events, defects, attendance, checkins, bakar_reports, accident_reports] = await Promise.all([
    all('sites', '&demo=eq.false'), all('site_people', '&active=eq.true'), all('duties'), all('events'), all('defects').catch(() => []),
    all('attendance', `&day=gte.${since}`).catch(() => []), all('checkins', `&at=gte.${since}`), all('bakar_reports').catch(() => []), all('accident_reports').catch(() => [])]);
  // לדוח החודשי: רק עמודות של ספירה (בלי חתימות, תמונות ופרטי עובדים)
  const [trainings, training_signatures, workers, equipment_checks, site_inspections] = await Promise.all([
    all('trainings', `&held_at=gte.${since}`, 'id,site_id,held_at').catch(() => []), all('training_signatures', `&signed_at=gte.${since}`, 'id,site_id,signed_at').catch(() => []),
    all('workers', `&created_at=gte.${since}`, 'id,site_id,created_at').catch(() => []), all('equipment_checks', `&day=gte.${since}`, 'id,site_id,day,ok').catch(() => []),
    all('site_inspections', `&started_at=gte.${since}`, 'id,site_id,started_at').catch(() => [])]);
  return { sites, site_people, duties, events, defects, attendance, checkins, bakar_reports, accident_reports, trainings, training_signatures, workers, equipment_checks, site_inspections };
}

// ===== גיבוי חודשי: כל הטבלאות לקובץ JSON דחוס בתיקייה פרטית (backups) שרק מנהל השירות רואה =====
const TABLES = ['profiles', 'orgs', 'memberships', 'sites', 'site_orgs', 'site_people', 'duties', 'events', 'notifications', 'files', 'audit_log', 'checkins', 'notices', 'signatures', 'workers',
  'trainings', 'training_signatures', 'equipment', 'inspections', 'attendance', 'worker_exemptions', 'site_inspections', 'defects', 'bakar_reports', 'accident_reports', 'mail_log',
  'equipment_checks', 'safety_plans', 'share_links'];
async function backup(day: string) {
  const dump = { made_at: new Date().toISOString(), tables: {} };
  for (const t of TABLES) dump.tables[t] = await all(t).catch(e => ({ error: String(e.message || e) }));
  const gz = new Blob([JSON.stringify(dump)]).stream().pipeThrough(new CompressionStream('gzip'));
  const body = new Uint8Array(await new Response(gz).arrayBuffer());
  const path = `${day}-safety-backup.json.gz`;
  const r = await fetch(`${URL0}/storage/v1/object/backups/${path}`, { method: 'POST', headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/gzip', 'x-upsert': 'true' }, body });
  if (!r.ok) throw new Error('backup upload: ' + r.status + ' ' + await r.text());
  const rows = Object.values(dump.tables).reduce((n: number, x) => n + (Array.isArray(x) ? x.length : 0), 0);
  return { path, bytes: body.length, rows };
}

async function send(m) {
  if (!RESEND) return { ok: false, error: 'RESEND_API_KEY missing' };
  const body = { from: FROM, to: m.to, subject: m.subject, html: m.html, text: m.text, ...(m.cc?.length ? { cc: m.cc } : {}), ...(REPLY_TO ? { reply_to: REPLY_TO } : {}) };
  for (let i = 0; i < 3; i++) {
    const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${RESEND}`, 'Content-Type': 'application/json', 'Idempotency-Key': m.key.slice(0, 256) }, body: JSON.stringify(body) });
    if (r.ok) return { ok: true, id: (await r.json()).id };
    if (r.status === 429 || r.status >= 500) { await sleep(1500 * (i + 1)); continue; }
    return { ok: false, error: `${r.status} ${await r.text()}`.slice(0, 500) };
  }
  return { ok: false, error: 'rate limited' };
}

Deno.serve(async req => {
  try {
    const [cfg] = await rest('mail_settings?select=secret,enabled&id=eq.1');
    if (!cfg?.secret || req.headers.get('x-cron-secret') !== cfg.secret) return new Response('forbidden', { status: 403 });
    const opts = await req.json().catch(() => ({}));
    // עד שמפעילים (enabled), השליחה האוטומטית רק מחשבת מה הייתה שולחת
    if ((!cfg.enabled || !RESEND) && !opts.test) opts.dry = true;
    // בדיקה: מייל אחד לכתובת שנמסרה
    if (opts.test) {
      const r = await send({ key: 'test:' + Date.now(), to: [opts.test], subject: 'מייל בדיקה ממערכת הבטיחות', text: 'אם קיבלת את המייל הזה, השליחה מהשרת עובדת.',
        html: '<div dir="rtl" style="font-family:Arial">אם קיבלת את המייל הזה, השליחה מהשרת של מערכת הבטיחות עובדת. 👍</div>' });
      return new Response(JSON.stringify(r), { headers: { 'Content-Type': 'application/json' } });
    }
    // גיבוי: ב-1 לכל חודש מ-03:00 (שעון ישראל), פעם אחת. אפשר גם לבקש בכוח עם backup: true
    const now = Date.now(), t = israelNow(now), bkey = 'backup:' + t.day.slice(0, 7);
    let bk = null;
    if (opts.backup || (t.day.endsWith('-01') && t.hour >= 3)) {
      const had = opts.backup ? [] : await rest(`mail_log?select=key&ok=eq.true&key=eq.${encodeURIComponent(bkey)}`);
      if (!had.length) {
        try { bk = await backup(t.day); } catch (e) { bk = { error: String(e?.message || e) }; }
        const admins = (await rest('profiles?select=email&is_service_admin=eq.true')).map(x => String(x.email || '').toLowerCase()).filter(Boolean);
        const subject = bk.error ? '⚠️ הגיבוי החודשי של מערכת הבטיחות נכשל' : 'הגיבוי החודשי של מערכת הבטיחות נשמר';
        const txt = bk.error ? 'הגיבוי נכשל: ' + bk.error : `נשמר גיבוי של ${bk.rows} שורות (${Math.round(bk.bytes / 1024)} KB). מורידים אותו ממסך "הגדרות ותצוגה" במערכת.`;
        let ok = !bk.error, provider_id = null, error = bk.error || null;
        if (admins.length && cfg.enabled) { const r = await send({ key: bkey + ':mail', to: admins, subject, text: txt, html: `<div dir="rtl" style="font-family:Arial">${txt}</div>` }); provider_id = r.id || null; }
        if (!opts.backup) await rest('mail_log?on_conflict=key', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
          body: JSON.stringify({ key: bkey, kind: 'backup', to_list: admins, subject: bk.path || subject, ok, provider_id, error, sent_at: new Date().toISOString() }) });
      }
    }
    const data = await load();
    const mails = plan(data, now, opts);
    if (!mails.length) return new Response(JSON.stringify({ planned: 0, sent: 0, dry: !!opts.dry, backup: bk }));
    // מה כבר נשלח (מפתח לכל מייל: התראה פעם אחת לחובה, סיכום פעם ביום לאדם, דוח פעם בשבוע)
    const keys = [...new Set(mails.map(m => m.key))];
    const done = new Set();
    for (let i = 0; i < keys.length; i += 100) {
      const part = keys.slice(i, i + 100).map(k => `"${k.replace(/"/g, '')}"`).join(',');
      (await rest(`mail_log?select=key&ok=eq.true&key=in.(${encodeURIComponent(part)})`)).forEach(x => done.add(x.key));
    }
    let sent = 0, failed = 0;
    const todo = mails.filter(m => !done.has(m.key));
    if (opts.dry) return new Response(JSON.stringify({ dry: true, planned: mails.length, skipped: done.size, would_send: todo.map(m => ({ kind: m.kind, to: m.to, cc: m.cc, subject: m.subject })) }), { headers: { 'Content-Type': 'application/json' } });
    for (const m of todo) {
      const r = await send(m);
      await rest('mail_log?on_conflict=key', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify({ key: m.key, kind: m.kind, site_id: m.site_id || null, to_list: [...m.to, ...(m.cc || [])], subject: m.subject, ok: r.ok, provider_id: r.id || null, error: r.error || null, sent_at: new Date().toISOString() }) });
      r.ok ? sent++ : failed++;
      await sleep(600); // Resend בחינם: עד 2 מיילים בשנייה
    }
    return new Response(JSON.stringify({ planned: mails.length, skipped: done.size, sent, failed, backup: bk }), { headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e?.message || e) }), { status: 500 });
  }
});
