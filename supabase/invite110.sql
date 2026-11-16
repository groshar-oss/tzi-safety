-- חבילה 1.10: הזמנה לאפליקציה בקישור, עם אישור של מנהל המערכת
-- להריץ פעם אחת ב-SQL Editor. בטוח להריץ שוב.
--
-- איך זה עובד:
-- 1. מי שממנה בעלי תפקידים באתר (או מנהל המערכת) יוצר קישור הזמנה לתפקיד מסוים באתר מסוים.
-- 2. הקישור אישי, לשימוש אחד, ובתוקף 72 שעות. בטבלה נשמרת רק טביעת אצבע שלו (SHA-256).
-- 3. המוזמן ממלא פרטים, מצרף תעודה אם התפקיד דורש, ובוחר סיסמה. הבקשה ממתינה לאישור.
-- 4. רק מנהל המערכת (is_service_admin) מאשר או דוחה. באישור, המוזמן נוסף לבעלי התפקידים באתר ומקבל גישה.

-- ===== 1. טבלאות =====
create table if not exists site_invites (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id) on delete cascade,
  role text not null check (role in ('dev','bakar','con','so','sm','wm','rep','fa')),
  backup boolean not null default false,
  label text,                                   -- למי נשלח (לזיהוי בלבד)
  token_hash text not null unique,
  status text not null default 'open' check (status in ('open','pending','approved','rejected','revoked')),
  expires_at timestamptz not null,
  created_by_email text,
  created_at timestamptz not null default now(),
  opened_at timestamptz,
  open_count int not null default 0,
  -- מה שהמוזמן מילא
  name text,
  phone text,
  email text,
  license text,
  doc_name text,
  doc_type text,
  has_doc boolean not null default false,
  submitted_at timestamptz,
  user_agent text,
  -- ההחלטה
  person_id uuid references site_people(id) on delete set null,
  decided_by_email text,
  decided_at timestamptz,
  reject_reason text
);
create index if not exists site_invites_site on site_invites(site_id, status);
create index if not exists site_invites_email on site_invites(lower(email));

-- התעודה שהמוזמן צירף: בטבלה נפרדת, נשלפת רק בפונקציה עם בדיקת הרשאה
create table if not exists site_invite_docs (
  invite_id uuid primary key references site_invites(id) on delete cascade,
  data text not null,
  created_at timestamptz not null default now()
);

alter table site_invites enable row level security;
alter table site_invite_docs enable row level security;
drop policy if exists p_si_sel on site_invites;
create policy p_si_sel on site_invites for select using (is_service_admin()
  or has_site_role(site_id, case when role in ('dev','bakar') then array['dev'] else array['con'] end));
revoke all on site_invites from anon, authenticated;
grant select on site_invites to authenticated;
revoke all on site_invite_docs from anon, authenticated;

-- ===== 2. פונקציות =====
-- תפקידים שחובה לצרף להם תעודה
create or replace function invite_doc_required(r text) returns boolean language sql immutable as $$
  select r in ('wm','so','bakar','fa')
$$;

-- יצירת הזמנה. הקישור מוחזר פעם אחת בלבד
create or replace function invite_create(p_site uuid, p_role text, p_label text default null, p_backup boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare tok text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''); r site_invites;
begin
  if p_role not in ('dev','bakar','con','so','sm','wm','rep','fa') then raise exception 'bad_role: תפקיד לא מוכר'; end if;
  if not (is_service_admin() or has_site_role(p_site, case when p_role in ('dev','bakar') then array['dev'] else array['con'] end)) then
    raise exception 'no_permission: אין לך הרשאה להזמין לתפקיד הזה באתר';
  end if;
  insert into site_invites (site_id, role, backup, label, token_hash, expires_at, created_by_email)
  values (p_site, p_role, coalesce(p_backup, false), left(nullif(trim(p_label), ''), 200), share_hash(tok), now() + interval '72 hours', my_email())
  returning * into r;
  return jsonb_build_object('id', r.id, 'token', tok, 'expires_at', r.expires_at);
end $$;

create or replace function invite_revoke(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r site_invites;
begin
  select * into r from site_invites where id = p_id;
  if r.id is null then raise exception 'not_found'; end if;
  if not (is_service_admin() or has_site_role(r.site_id, case when r.role in ('dev','bakar') then array['dev'] else array['con'] end)) then raise exception 'no_permission: אין לך הרשאה'; end if;
  update site_invites set status = 'revoked', decided_at = now(), decided_by_email = my_email() where id = p_id and status in ('open','pending');
end $$;

-- מה שהמוזמן רואה כשהוא פותח את הקישור (בלי כניסה)
create or replace function invite_info(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r site_invites; s sites;
begin
  select * into r from site_invites where token_hash = share_hash(p_token);
  if r.id is null or r.status = 'revoked' then raise exception 'bad_link: הקישור לא בתוקף. צריך לבקש קישור חדש'; end if;
  if r.status = 'open' and r.expires_at < now() then raise exception 'expired: תוקף הקישור פג. צריך לבקש קישור חדש'; end if;
  select * into s from sites where id = r.site_id;
  update site_invites set opened_at = now(), open_count = open_count + 1 where id = r.id;
  return jsonb_build_object('site', s.name, 'address', s.address, 'role', r.role, 'status', r.status, 'expires_at', r.expires_at,
    'doc_required', invite_doc_required(r.role), 'name', case when r.status <> 'open' then r.name end,
    'email', case when r.status <> 'open' then r.email end, 'reject_reason', case when r.status = 'rejected' then r.reject_reason end);
end $$;

-- המוזמן שולח את הפרטים. אפשר לשלוח שוב (למשל לתקן) כל עוד לא הוחלט, ורק עם אותו אימייל
create or replace function invite_submit(p_token text, p_name text, p_phone text, p_email text, p_license text,
  p_doc text default null, p_doc_name text default null, p_ua text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r site_invites; em text := lower(trim(coalesce(p_email, ''))); dtype text;
begin
  select * into r from site_invites where token_hash = share_hash(p_token) for update;
  if r.id is null or r.status not in ('open','pending') then raise exception 'bad_link: הקישור לא בתוקף. צריך לבקש קישור חדש'; end if;
  if r.status = 'open' and r.expires_at < now() then raise exception 'expired: תוקף הקישור פג. צריך לבקש קישור חדש'; end if;
  if r.status = 'pending' and lower(r.email) <> em then raise exception 'used: כבר נשלחה בקשה מהקישור הזה'; end if;
  if length(trim(coalesce(p_name, ''))) < 2 then raise exception 'bad_name: צריך שם מלא'; end if;
  if em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'bad_email: האימייל לא תקין'; end if;
  if length(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g')) < 9 then raise exception 'bad_phone: צריך מספר טלפון נייד'; end if;
  if p_doc is not null then
    if length(p_doc) > 8000000 then raise exception 'doc_too_big: הקובץ גדול מדי (עד 5MB)'; end if;
    dtype := substring(p_doc from '^data:([a-z]+/[a-z0-9.+-]+);base64,');
    if dtype is null or dtype not in ('image/jpeg','image/png','image/webp','application/pdf') then raise exception 'bad_doc: אפשר לצרף תמונה או PDF'; end if;
  end if;
  if invite_doc_required(r.role) and p_doc is null and not r.has_doc then raise exception 'doc_required: צריך לצרף את התעודה'; end if;
  update site_invites set status = 'pending', name = left(trim(p_name), 120), phone = left(trim(p_phone), 30), email = em,
    license = left(nullif(trim(p_license), ''), 200), submitted_at = now(), user_agent = left(p_ua, 300),
    has_doc = has_doc or p_doc is not null, doc_type = coalesce(dtype, doc_type), doc_name = coalesce(left(p_doc_name, 120), doc_name)
  where id = r.id;
  if p_doc is not null then
    insert into site_invite_docs (invite_id, data) values (r.id, p_doc) on conflict (invite_id) do update set data = excluded.data, created_at = now();
  end if;
  return jsonb_build_object('status', 'pending');
end $$;

-- אישור או דחייה: רק מנהל המערכת
create or replace function invite_decide(p_id uuid, p_ok boolean, p_reason text default null, p_backup boolean default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r site_invites; pid uuid;
begin
  if not is_service_admin() then raise exception 'no_permission: רק מנהל המערכת מאשר הצטרפות'; end if;
  select * into r from site_invites where id = p_id for update;
  if r.id is null then raise exception 'not_found'; end if;
  if r.status <> 'pending' then raise exception 'not_pending: הבקשה כבר טופלה'; end if;
  if p_ok then
    select id into pid from site_people where site_id = r.site_id and role = r.role and active and lower(coalesce(email, '')) = lower(r.email) limit 1;
    if pid is null then
      insert into site_people (site_id, role, name, phone, email, license, from_date, backup, active)
      values (r.site_id, r.role, r.name, r.phone, r.email, r.license, (now() at time zone 'Asia/Jerusalem')::date, coalesce(p_backup, r.backup), true)
      returning id into pid;
    end if;
    update site_invites set status = 'approved', person_id = pid, decided_at = now(), decided_by_email = my_email() where id = r.id;
  else
    update site_invites set status = 'rejected', reject_reason = left(nullif(trim(p_reason), ''), 500), decided_at = now(), decided_by_email = my_email() where id = r.id;
  end if;
  return jsonb_build_object('status', case when p_ok then 'approved' else 'rejected' end, 'person_id', pid);
end $$;

-- התעודה שצורפה: למנהל המערכת ולמי שממנה את התפקיד באתר
create or replace function invite_doc(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r site_invites; d text;
begin
  select * into r from site_invites where id = p_id;
  if r.id is null then raise exception 'not_found'; end if;
  if not (is_service_admin() or has_site_role(r.site_id, case when r.role in ('dev','bakar') then array['dev'] else array['con'] end)) then raise exception 'no_permission: אין לך הרשאה'; end if;
  select data into d from site_invite_docs where invite_id = p_id;
  return jsonb_build_object('data', d, 'name', r.doc_name, 'type', r.doc_type);
end $$;

-- למשתמש שנרשם ועוד לא אושר: מה מצב הבקשה שלו
create or replace function invite_mine() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('site', s.name, 'role', i.role, 'status', i.status, 'submitted_at', i.submitted_at, 'reject_reason', i.reject_reason) order by i.submitted_at desc), '[]'::jsonb)
  from site_invites i join sites s on s.id = i.site_id
  where my_email() <> '' and lower(i.email) = my_email() and i.status in ('pending','rejected') and i.submitted_at > now() - interval '60 days'
$$;

revoke execute on function invite_doc_required(text) from public, anon;
revoke execute on function invite_create(uuid, text, text, boolean), invite_revoke(uuid), invite_decide(uuid, boolean, text, boolean), invite_doc(uuid), invite_mine() from public, anon;
grant execute on function invite_create(uuid, text, text, boolean), invite_revoke(uuid), invite_decide(uuid, boolean, text, boolean), invite_doc(uuid), invite_mine() to authenticated;
revoke execute on function invite_info(text), invite_submit(text, text, text, text, text, text, text, text) from public;
grant execute on function invite_info(text), invite_submit(text, text, text, text, text, text, text, text) to anon, authenticated;

notify pgrst, 'reload schema';
