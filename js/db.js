// שכבת נתונים: מצב ענן (Supabase) או מצב הדגמה (נשמר בדפדפן בלבד)
import { CONFIG } from './config.js';
import { store } from './util.js';
import { demoData } from './demo.js';
import { queue, flush, isNetErr, looksOffline, localFile, refreshCount } from './offline.js';

const LOCAL_KEY = 'grosher-safety-demo-v1';
export const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
  const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); }));

const TABLES = ['orgs', 'memberships', 'sites', 'site_orgs', 'site_people', 'duties', 'events', 'notifications', 'files', 'audit_log', 'checkins', 'notices', 'signatures', 'workers', 'trainings', 'training_signatures', 'equipment', 'inspections', 'attendance', 'worker_exemptions', 'site_inspections', 'defects', 'bakar_reports', 'accident_reports', 'equipment_checks', 'safety_plans', 'share_links', 'site_invites', 'site_invite_docs', 'site_invite_sigs'];
const AUDITED = ['orgs', 'memberships', 'sites', 'site_orgs', 'site_people', 'duties', 'events', 'notices', 'workers', 'trainings', 'equipment', 'inspections', 'attendance', 'worker_exemptions', 'site_inspections', 'defects', 'bakar_reports', 'accident_reports', 'equipment_checks', 'safety_plans'];

function match(row, q = {}) {
  for (const [k, v] of Object.entries(q.eq || {})) if (String(row[k] ?? '') !== String(v ?? '')) return false;
  for (const [k, arr] of Object.entries(q.in || {})) if (!arr.map(String).includes(String(row[k]))) return false;
  return true;
}
function orderRows(rows, order) {
  if (!order) return rows;
  const keys = Array.isArray(order) ? order : [order];
  return rows.sort((a, b) => {
    for (const k of keys) {
      const [f, dir] = k.split(' ');
      const x = a[f] ?? '', y = b[f] ?? '';
      const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'he', { numeric: true });
      if (c) return dir === 'desc' ? -c : c;
    }
    return 0;
  });
}

// ===== מצב הדגמה =====
class LocalDB {
  constructor() { this.mode = 'demo'; }
  async init() {
    this.data = store(LOCAL_KEY);
    if (!this.data || !this.data.tables) this.reset();
    for (const t of TABLES) this.data.tables[t] ||= [];
    this.data.role ||= 'admin';
    this.user = { id: 'demo-user', email: 'demo@grosher.local' };
    return this.user;
  }
  reset() { this.data = { tables: demoData(uuid), role: this.data?.role || 'admin' }; for (const t of TABLES) this.data.tables[t] ||= []; this.save(); }
  save() { store(LOCAL_KEY, this.data); }
  get role() { return this.data.role; }
  setRole(r) { this.data.role = r; this.save(); }
  async context() { return { isAdmin: this.data.role === 'admin', demoRole: this.data.role, memberships: [] }; }
  audit(table, action, row, old) {
    if (!AUDITED.includes(table)) return;
    this.data.tables.audit_log.push({ id: uuid(), at: new Date().toISOString(), user_email: window.__actor || 'demo', table_name: table, row_id: row.id,
      site_id: row.site_id || (table === 'sites' ? row.id : null), action, old_data: old || null, new_data: action === 'delete' ? null : { ...row } });
  }
  async select(table, q = {}) {
    const rows = (this.data.tables[table] || []).filter(r => match(r, q)).map(r => ({ ...r }));
    return orderRows(rows, q.order);
  }
  async insert(table, rows) {
    const arr = (Array.isArray(rows) ? rows : [rows]).map(r => ({ id: uuid(), created_at: new Date().toISOString(), ...r }));
    this.data.tables[table].push(...arr);
    arr.forEach(r => this.audit(table, 'insert', r));
    this.save();
    return arr.map(r => ({ ...r }));
  }
  async update(table, id, patch) {
    const row = this.data.tables[table].find(r => r.id === id);
    if (!row) throw new Error('הרשומה לא נמצאה');
    const old = { ...row };
    Object.assign(row, patch); this.audit(table, 'update', row, old); this.save(); return { ...row };
  }
  async remove(table, id) {
    if (['duties', 'audit_log', 'notifications', 'notices', 'signatures', 'workers', 'trainings', 'training_signatures', 'equipment', 'inspections', 'attendance', 'worker_exemptions', 'site_inspections', 'defects', 'bakar_reports', 'accident_reports', 'equipment_checks', 'safety_plans', 'share_links', 'site_invites'].includes(table)) throw new Error('אי אפשר למחוק רשומה זו. אפשר לסגור אותה עם נימוק.');
    const row = this.data.tables[table].find(r => r.id === id);
    this.data.tables[table] = this.data.tables[table].filter(r => r.id !== id);
    if (row) this.audit(table, 'delete', row, { ...row });
    this.save();
  }
  async signOut() {}
  async flush() { return 0; }
  // קישורים בלי כניסה במצב הדגמה: אותה התנהגות כמו הפונקציות בשרת (field18.sql)
  async rpc(name, a) { return demoRpc(this, name, a); }
  async signedUrls() { return {}; }
}

const HOUR = 36e5;
function demoRpc(L, name, a) {
  const T = L.data.tables, now = new Date(), iso = now.toISOString();
  const link = (tok, kind) => T.share_links.find(r => r.token_hash === 'demo:' + tok && r.kind === kind);
  const bad = m => { throw new Error(m || 'הקישור לא בתוקף. צריך לבקש קישור חדש'); };
  if (name === 'share_link_create') {
    const tok = uuid().replace(/-/g, '') + uuid().replace(/-/g, '');
    let hours = a.p_hours;
    if (a.p_kind === 'training') {
      if (T.training_signatures.some(g => g.training_id === a.p_training && g.worker_id === a.p_worker)) bad('העובד כבר חתם על ההדרכה');
      hours = Math.min(Math.max(hours || 48, 1), 72);
      T.share_links.filter(r => r.kind === 'training' && r.training_id === a.p_training && r.worker_id === a.p_worker && !r.revoked_at && !r.used_at).forEach(r => { r.revoked_at = iso; });
    }
    const r = { id: uuid(), site_id: a.p_site, kind: a.p_kind, token_hash: 'demo:' + tok, label: a.p_label || null, training_id: a.p_training || null, worker_id: a.p_worker || null,
      payload: a.p_kind === 'inspector' ? a.p_payload || null : null, payload_at: a.p_payload ? iso : null, expires_at: new Date(+now + hours * HOUR).toISOString(),
      revoked_at: null, used_at: null, opened_at: null, open_count: 0, created_by_email: window.__actor || 'demo', created_at: iso };
    T.share_links.push(r); L.save();
    return { id: r.id, token: tok, expires_at: r.expires_at };
  }
  if (name === 'share_link_snapshot') { const r = T.share_links.find(x => x.id === a.p_id); if (!r || r.revoked_at || new Date(r.expires_at) < now) return null; Object.assign(r, { payload: a.p_payload, payload_at: iso }); L.save(); return iso; }
  if (name === 'share_link_revoke') { const r = T.share_links.find(x => x.id === a.p_id); if (r && !r.revoked_at) Object.assign(r, { revoked_at: iso, payload: null }); L.save(); return null; }
  if (name === 'share_inspector') {
    const r = link(a.p_token, 'inspector'); if (!r || r.revoked_at || new Date(r.expires_at) < now) bad('הקישור לא בתוקף. אפשר לבקש קישור חדש מהאתר');
    r.opened_at ||= iso; r.open_count++; L.save();
    return { site: T.sites.find(s => s.id === r.site_id)?.name, label: r.label, expires_at: r.expires_at, payload: r.payload, payload_at: r.payload_at };
  }
  if (name === 'share_training' || name === 'share_training_sign') {
    const r = link(a.p_token, 'training'); if (!r || r.revoked_at) bad();
    const t = T.trainings.find(x => x.id === r.training_id), w = T.workers.find(x => x.id === r.worker_id), s = T.sites.find(x => x.id === r.site_id);
    const g = T.training_signatures.find(x => x.training_id === t.id && x.worker_id === w.id);
    if (name === 'share_training') {
      if (!g && (new Date(r.expires_at) < now || t.closed_at)) bad();
      r.opened_at ||= iso; r.open_count++; L.save();
      return { site: s.name, expires_at: r.expires_at, training: { kind: t.kind, topic: t.topic, trainer_name: t.trainer_name, trainer_title: t.trainer_title, language: t.language, held_at: t.held_at },
        worker: { name: w.name, id_type: w.id_type, id_masked: '•'.repeat(Math.max(w.id_number.length - 3, 0)) + w.id_number.slice(-3), language: w.language }, signed_at: g?.signed_at || null };
    }
    if (r.used_at || g || new Date(r.expires_at) < now || t.closed_at) bad();
    if (!/^data:image\/png;base64,/.test(a.p_image || '')) bad('החתימה לא נקלטה. צריך לחתום שוב');
    const KH = { intro: 'הדרכה לעובד חדש לפני תחילת עבודה', annual: 'הדרכת בטיחות שנתית', height: 'הדרכה לעבודה בגובה', toolbox: 'תדריך בטיחות (שיחת בוקר)', other: 'הדרכה אחרת' };
    const statement = `אני, ${w.name}, ${w.id_type === 'passport' ? 'דרכון' : 'ת"ז'} ${w.id_number}, מאשר/ת שהיום, ${now.toLocaleDateString('he-IL')}, קיבלתי ${KH[t.kind] || KH.other} באתר ${s.name}, בנושא: ${t.topic}. ההדרכה ניתנה פנים אל פנים בידי ${t.trainer_name}, בשפה שאני מבין/ה (${t.language || '—'}), והבנתי אותה. (נחתם בטלפון של העובד דרך קישור אישי)`;
    const row = { id: uuid(), created_at: iso, training_id: t.id, site_id: s.id, worker_id: w.id, worker_name: w.name, statement, image: a.p_image,
      statement_local: a.p_local && a.p_lang ? a.p_local.replace('{{ID}}', w.id_number) : null, lang: a.p_local ? a.p_lang : null,
      signed_at: iso, client_signed_at: a.p_client_at || null, signed_by_email: 'קישור אישי בטלפון העובד', user_agent: (a.p_ua || '').slice(0, 300) };
    T.training_signatures.push(row); r.used_at = iso; L.audit('training_signatures', 'insert', row); L.save();
    return { signed_at: iso };
  }
  if (name.startsWith('invite_')) return demoInvite(L, name, a);
  throw new Error('rpc ' + name);
}

// הזמנה בקישור במצב הדגמה: אותה התנהגות כמו invite110.sql
const DOC_REQ = ['wm', 'so', 'bakar', 'fa'];
const sha256hex = async t => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t)))].map(b => b.toString(16).padStart(2, '0')).join('');
async function demoInvite(L, name, a) {
  const T = L.data.tables, now = new Date(), iso = now.toISOString(), me = (window.__actor || 'demo').toLowerCase();
  const bad = m => { throw new Error(m || 'הקישור לא בתוקף. צריך לבקש קישור חדש'); };
  const byTok = tok => T.site_invites.find(r => r.token_hash === 'demo:' + tok);
  const admin = () => L.data.role === 'admin';
  if (name === 'invite_create') {
    const tok = uuid().replace(/-/g, '') + uuid().replace(/-/g, '');
    const r = { id: uuid(), site_id: a.p_site, role: a.p_role, backup: !!a.p_backup, label: a.p_label || null, token_hash: 'demo:' + tok, status: 'open',
      expires_at: new Date(+now + 72 * HOUR).toISOString(), created_by_email: me, created_at: iso, opened_at: null, open_count: 0, has_doc: false };
    T.site_invites.push(r); L.save();
    return { id: r.id, token: tok, expires_at: r.expires_at };
  }
  if (name === 'invite_revoke') { const r = T.site_invites.find(x => x.id === a.p_id); if (r && ['open', 'pending'].includes(r.status)) Object.assign(r, { status: 'revoked', decided_at: iso, decided_by_email: me }); L.save(); return null; }
  if (name === 'invite_info') {
    const r = byTok(a.p_token); if (!r || r.status === 'revoked') bad();
    if (r.status === 'open' && new Date(r.expires_at) < now) bad('תוקף הקישור פג. צריך לבקש קישור חדש');
    const s = T.sites.find(x => x.id === r.site_id);
    r.opened_at = iso; r.open_count++; L.save();
    return { site: s?.name, address: s?.address, role: r.role, status: r.status, expires_at: r.expires_at, doc_required: DOC_REQ.includes(r.role),
      name: r.status !== 'open' ? r.name : null, email: r.status !== 'open' ? r.email : null, reject_reason: r.status === 'rejected' ? r.reject_reason : null,
      ...(r.role === 'rep' ? { site_id: s.id, profile: s.profile, backup: r.backup,
        con: (() => { const o = T.site_orgs.filter(x => x.site_id === s.id && x.kind === 'contractor').map(x => T.orgs.find(g => g.id === x.org_id)?.name).filter(Boolean); return o.length ? o : T.site_people.filter(p => p.site_id === s.id && p.role === 'con' && p.active !== false && !p.backup).map(p => p.name); })(),
        backups: T.site_people.filter(p => p.site_id === s.id && p.role === 'rep' && p.backup && p.active !== false).map(p => ({ name: p.name, phone: p.phone })) } : { con: [], backups: [] }) };
  }
  if (name === 'invite_submit') {
    const r = byTok(a.p_token); const em = String(a.p_email || '').trim().toLowerCase();
    if (!r || !['open', 'pending'].includes(r.status)) bad();
    if (r.status === 'open' && new Date(r.expires_at) < now) bad('תוקף הקישור פג. צריך לבקש קישור חדש');
    if (r.status === 'pending' && r.email !== em) bad('כבר נשלחה בקשה מהקישור הזה');
    if (String(a.p_name || '').trim().length < 2) bad('צריך שם מלא');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) bad('האימייל לא תקין');
    if (String(a.p_phone || '').replace(/\D/g, '').length < 9) bad('צריך מספר טלפון נייד');
    let type = null;
    if (a.p_doc) { type = (a.p_doc.match(/^data:([a-z]+\/[a-z0-9.+-]+);base64,/) || [])[1]; if (!['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(type)) bad('אפשר לצרף תמונה או PDF'); }
    if (DOC_REQ.includes(r.role) && !a.p_doc && !r.has_doc) bad('צריך לצרף את התעודה');
    if (r.role === 'rep' && (!/^data:image\/png;base64,/.test(a.p_sig || '') || (a.p_sig_body || '').length < 50)) bad('צריך לחתום על כתב ההסמכה');
    Object.assign(r, { status: 'pending', name: a.p_name.trim(), phone: a.p_phone.trim(), email: em, license: (a.p_license || '').trim() || null, submitted_at: iso, user_agent: a.p_ua || null,
      has_doc: r.has_doc || !!a.p_doc, doc_type: type || r.doc_type || null, doc_name: a.p_doc_name || r.doc_name || null });
    if (a.p_doc) { T.site_invite_docs = T.site_invite_docs.filter(d => d.invite_id !== r.id); T.site_invite_docs.push({ invite_id: r.id, data: a.p_doc, created_at: iso }); }
    if (a.p_sig) { r.has_sig = true; T.site_invite_sigs = T.site_invite_sigs.filter(d => d.invite_id !== r.id); T.site_invite_sigs.push({ invite_id: r.id, image: a.p_sig, body: a.p_sig_body, signer_title: a.p_sig_title || null, created_at: iso }); }
    L.save(); return { status: 'pending' };
  }
  if (name === 'invite_decide') {
    if (!admin()) bad('רק מנהל המערכת מאשר הצטרפות');
    const r = T.site_invites.find(x => x.id === a.p_id); if (!r) bad('not_found');
    if (r.status !== 'pending') bad('הבקשה כבר טופלה');
    let pid = null;
    if (a.p_ok) {
      const ex = T.site_people.find(p => p.site_id === r.site_id && p.role === r.role && p.active !== false && (p.email || '').toLowerCase() === r.email);
      if (ex) pid = ex.id;
      else {
        const p = { id: uuid(), created_at: iso, site_id: r.site_id, role: r.role, name: r.name, phone: r.phone, email: r.email, license: r.license,
          from_date: new Date(r.submitted_at).toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' }), to_date: null, backup: a.p_backup ?? r.backup, active: true };
        T.site_people.push(p); L.audit('site_people', 'insert', p); pid = p.id;
      }
      const g = T.site_invite_sigs.find(x => x.invite_id === r.id);
      if (r.role === 'rep' && g) {
        const hash = await sha256hex(g.body);
        T.signatures.push({ id: uuid(), created_at: iso, site_id: r.site_id, doc_type: 'auth_letter', doc_ref: pid, doc_hash: hash, doc_snapshot: g.body, slot: 'rep', signer_name: r.name,
          signer_title: g.signer_title || 'נציג מבצע הבנייה באתר', image: g.image, signed_by_email: r.email + ' (בהרשמה דרך קישור)', signed_at: r.submitted_at, user_agent: r.user_agent });
      }
      Object.assign(r, { status: 'approved', person_id: pid, decided_at: iso, decided_by_email: me });
    } else Object.assign(r, { status: 'rejected', reject_reason: a.p_reason || null, decided_at: iso, decided_by_email: me });
    L.save(); return { status: r.status, person_id: pid };
  }
  if (name === 'invite_doc') { const r = T.site_invites.find(x => x.id === a.p_id); return { data: T.site_invite_docs.find(d => d.invite_id === a.p_id)?.data || null, name: r?.doc_name, type: r?.doc_type }; }
  if (name === 'invite_mine') return [];
  throw new Error('rpc ' + name);
}

// קבצים במצב הדגמה: IndexedDB בדפדפן
function idb() {
  return new Promise((res, rej) => { const r = indexedDB.open('grosher-safety-files', 1); r.onupgradeneeded = () => r.result.createObjectStore('f'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}
async function idbDo(mode, fn) { const d = await idb(); return new Promise((res, rej) => { const tx = d.transaction('f', mode); const r = fn(tx.objectStore('f')); tx.oncomplete = () => res(r?.result); tx.onerror = () => rej(tx.error); }); }
LocalDB.prototype.putFile = async function (path, blob) { await idbDo('readwrite', s => s.put(blob, path)); };
LocalDB.prototype.getFile = async function (path) { const b = await idbDo('readonly', s => s.get(path)); if (!b) throw new Error('הקובץ לא נמצא בדפדפן הזה'); return b; };

// ===== מצב ענן =====
class CloudDB {
  constructor() { this.mode = 'cloud'; }
  async init() {
    const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm');
    this.recovery = /type=recovery/.test(location.hash);
    // קליטה חלשה: בקשה שלא נענית תוך 45 שניות נחשבת כמו בלי קליטה, והפעולה נשמרת בטלפון
    const tfetch = (u, o = {}) => fetch(u, { ...o, signal: o.signal || (AbortSignal.timeout ? AbortSignal.timeout(45e3) : undefined) });
    this.sb = createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey, { auth: { persistSession: true }, global: { fetch: tfetch } });
    this.sb.auth.onAuthStateChange(ev => { if (ev === 'PASSWORD_RECOVERY') this.recovery = true; });
    const { data, error } = await this.sb.auth.getSession().catch(e => ({ data: {}, error: e }));
    if (/access_token|type=/.test(location.hash)) history.replaceState(null, '', location.pathname + location.search + '#/');
    let u = data?.session?.user;
    // בלי קליטה אי אפשר לחדש את ההתחברות: ממשיכים עם המשתמש השמור בטלפון, והחידוש יקרה כשחוזרת קליטה
    if (!u && (looksOffline() || isNetErr(error))) {
      try { const k = Object.keys(localStorage).find(x => /^sb-.*-auth-token$/.test(x)); u = k ? JSON.parse(localStorage.getItem(k))?.user : null; } catch { u = null; }
    }
    this.user = u ? { id: u.id, email: u.email } : null;
    refreshCount();
    return this.user;
  }
  async signIn(email, password) {
    const { data, error } = await this.sb.auth.signInWithPassword({ email, password });
    if (error) throw new Error(heAuthError(error.message));
    this.user = { id: data.user.id, email: data.user.email }; return this.user;
  }
  async signUp(email, password) {
    const { data, error } = await this.sb.auth.signUp({ email, password, options: { emailRedirectTo: location.href.split('#')[0] } });
    if (error) { if (/already registered/i.test(error.message)) return 'exists'; throw new Error(heAuthError(error.message)); }
    // אימייל שכבר רשום: השרת לא מגלה את זה בשגיאה, אבל מחזיר משתמש בלי זהויות
    if (data.user && Array.isArray(data.user.identities) && !data.user.identities.length) return 'exists';
    return data.session ? 'signed_in' : 'confirm_email';
  }
  async resetPassword(email) {
    const { error } = await this.sb.auth.resetPasswordForEmail(email, { redirectTo: location.href.split('#')[0] });
    if (error) throw new Error(heAuthError(error.message));
  }
  async setPassword(password) {
    const { error } = await this.sb.auth.updateUser({ password });
    if (error) throw new Error(heAuthError(error.message));
    this.recovery = false;
  }
  async signOut() { await this.sb.auth.signOut(); this.user = null; }
  async context() {
    const isAdmin = !!(await this.rpc('claim_service_admin', {}));
    const memberships = await this.select('memberships', { eq: { email: (this.user.email || '').toLowerCase() } });
    return { isAdmin, memberships };
  }
  q(table, q = {}) {
    let s = this.sb.from(table).select('*');
    for (const [k, v] of Object.entries(q.eq || {})) s = v === null ? s.is(k, null) : s.eq(k, v);
    for (const [k, arr] of Object.entries(q.in || {})) s = s.in(k, arr);
    for (const o of [].concat(q.order || [])) { const [f, dir] = o.split(' '); s = s.order(f, { ascending: dir !== 'desc' }); }
    return s;
  }
  async select(table, q = {}) {
    const all = []; let from = 0;
    for (;;) {
      const { data, error } = await this.q(table, q).range(from, from + 999);
      if (error) throw dbErr(error);
      all.push(...data); if (data.length < 1000) break; from += 1000;
    }
    return all;
  }
  // כתיבה: אם אין קליטה, נשמר בטלפון ונשלח אחר כך. מחזירים את השורה כאילו נשמרה
  async insert(table, rows) {
    // מזהה נקבע בטלפון, כדי ששליחה חוזרת אחרי ניתוק לא תיצור כפילות
    const arr = (Array.isArray(rows) ? rows : [rows]).map(r => r.id ? r : { id: uuid(), ...r });
    if (looksOffline()) return this.queueInsert(table, arr);
    try { return await this.rawInsert(table, arr); } catch (e) { if (isNetErr(e)) return this.queueInsert(table, arr); throw e; }
  }
  async queueInsert(table, arr) {
    const now = new Date().toISOString();
    const rows = arr.map(r => ({ id: uuid(), created_at: now, ...r }));
    await queue({ kind: 'insert', table, rows });
    return rows.map(r => ({ ...r, _pending: true }));
  }
  async update(table, id, patch) {
    if (looksOffline()) return this.queueUpdate(table, id, patch);
    try { return await this.rawUpdate(table, id, patch); } catch (e) { if (isNetErr(e)) return this.queueUpdate(table, id, patch); throw e; }
  }
  async queueUpdate(table, id, patch) { await queue({ kind: 'update', table, id, patch }); return { id, ...patch, _pending: true }; }
  async putFile(path, blob) {
    if (looksOffline()) return queue({ kind: 'file', path, blob });
    try { return await this.rawPutFile(path, blob); } catch (e) { if (isNetErr(e)) return queue({ kind: 'file', path, blob }); throw e; }
  }
  async getFile(path) {
    const local = await localFile(path); if (local) return local;
    return this.rawGetFile(path);
  }
  // שליחת מה שנשמר בטלפון
  async flush() { if (!this.user) return 0; return flush({ insert: (t, r) => this.rawInsert(t, r), update: (t, i, p) => this.rawUpdate(t, i, p), putFile: (p, b) => this.rawPutFile(p, b) }); }
  async rawInsert(table, arr) {
    const out = [];
    for (let i = 0; i < arr.length; i += 500) {
      const { data, error } = await this.sb.from(table).insert(arr.slice(i, i + 500), { defaultToNull: false }).select();
      if (error) throw dbErr(error);
      out.push(...data);
    }
    return out;
  }
  async rawUpdate(table, id, patch) {
    const { data, error } = await this.sb.from(table).update(patch).eq('id', id).select().single();
    if (error) throw dbErr(error); return data;
  }
  async remove(table, id) { const { error } = await this.sb.from(table).delete().eq('id', id); if (error) throw dbErr(error); }
  async rawPutFile(path, blob) {
    const { error } = await this.sb.storage.from('files').upload(path, blob, { contentType: blob.type || 'application/octet-stream', upsert: false });
    if (error) throw dbErr(error);
  }
  async rawGetFile(path) {
    const { data, error } = await this.sb.storage.from('files').download(path);
    if (error) throw dbErr(error); return data;
  }
  async rpc(name, args) {
    const { data, error } = await this.sb.rpc(name, args);
    if (error) throw dbErr(error); return data;
  }
  // קישורים חתומים לקבצים, לצפייה בלי כניסה (קישור המפקח). path ← url
  async signedUrls(paths, seconds) {
    const list = [...new Set(paths.filter(Boolean))]; if (!list.length) return {};
    const { data, error } = await this.sb.storage.from('files').createSignedUrls(list, Math.max(60, Math.floor(seconds)));
    if (error) throw dbErr(error);
    return Object.fromEntries((data || []).filter(x => x.signedUrl).map(x => [x.path, x.signedUrl]));
  }
}

export function dbErr(error) {
  const m = error?.message || String(error);
  let he = m;
  if (error?.code === '23503') he = 'אי אפשר למחוק: יש רשומות אחרות שקשורות לזה.';
  else if (error?.code === 'PGRST116' || error?.code === '42501' || /row-level security|permission denied/i.test(m)) he = 'אין לך הרשאה לפעולה הזו.';
  else if (error?.code === '23505') he = 'הרשומה כבר קיימת.';
  else if (/role_conflict/.test(m)) he = 'אי אפשר למנות את אותו אדם לשני התפקידים האלה באותו אתר (תקנות 2א(א)(2), 2ב(א)(2)).';
  else if (/no_delete/.test(m)) he = 'אי אפשר למחוק רשומה זו. אפשר לסגור אותה עם נימוק.';
  else if (/^[a-z_0-9]+: .*[א-ת]/.test(m)) he = m.replace(/^[a-z_0-9]+: /, '');
  const e = new Error(he); e.code = error?.code; e.raw = m;
  if (/Failed to fetch|NetworkError|network|Load failed|abort|timed? ?out/i.test(m)) { e.offline = true; e.message = 'אין חיבור לאינטרנט.'; }
  return e;
}

function heAuthError(m) {
  if (/Invalid login/i.test(m)) return 'אימייל או סיסמה שגויים';
  if (/Email not confirmed/i.test(m)) return 'צריך לאשר את האימייל (קישור נשלח לתיבת הדואר)';
  if (/already registered/i.test(m)) return 'האימייל כבר רשום. אפשר להתחבר.';
  if (/Password should be/i.test(m)) return 'הסיסמה קצרה מדי (לפחות 6 תווים)';
  return m;
}

export const isCloud = () => !!(CONFIG.supabaseUrl && CONFIG.supabaseAnonKey);
export const db = isCloud() ? new CloudDB() : new LocalDB();
