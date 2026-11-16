-- חבילה 1.10ב: נציג מבצע הבנייה חותם על כתב ההסמכה כבר בעמוד ההרשמה
-- להריץ פעם אחת ב-SQL Editor, אחרי invite110.sql. בטוח להריץ שוב.
-- באישור ההרשמה החתימה נשמרת בחתימות של כתב ההסמכה, עם נוסח הכתב שהנציג ראה, שעת השליחה וטביעת האצבע.

-- ===== 1. החתימה מההרשמה: טבלה נפרדת, רק השרת קורא =====
create table if not exists site_invite_sigs (
  invite_id uuid primary key references site_invites(id) on delete cascade,
  image text not null,
  body text not null,
  body_hash text not null,
  signer_title text,
  created_at timestamptz not null default now()
);
alter table site_invite_sigs enable row level security;
revoke all on site_invite_sigs from anon, authenticated;
alter table site_invites add column if not exists has_sig boolean not null default false;

-- ===== 2. חתימה שמגיעה מההרשמה נשמרת עם המועד והמייל של הנציג (לא של מי שאישר) =====
create or replace function signature_stamp() returns trigger language plpgsql set search_path = public as $$
begin
  new.created_at := now();
  if current_setting('safety.invite_sig', true) = '1' then return new; end if;
  new.signed_by_email := my_email();
  new.signed_at := now();
  return new;
end $$;
revoke execute on function signature_stamp() from public, anon, authenticated;

-- ===== 3. מה שעמוד ההרשמה צריך כדי להציג לנציג את כתב ההסמכה =====
create or replace function invite_info(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r site_invites; s sites; con text[]; bk jsonb;
begin
  select * into r from site_invites where token_hash = share_hash(p_token);
  if r.id is null or r.status = 'revoked' then raise exception 'bad_link: הקישור לא בתוקף. צריך לבקש קישור חדש'; end if;
  if r.status = 'open' and r.expires_at < now() then raise exception 'expired: תוקף הקישור פג. צריך לבקש קישור חדש'; end if;
  select * into s from sites where id = r.site_id;
  update site_invites set opened_at = now(), open_count = open_count + 1 where id = r.id;
  if r.role = 'rep' and r.status = 'open' then
    -- אותו סדר כמו באפליקציה: ארגוני הקבלן לפי סדר השיוך, ואם אין - בעלי התפקיד "מבצע הבנייה"
    select array_agg(o.name order by so.created_at) into con from site_orgs so join orgs o on o.id = so.org_id where so.site_id = r.site_id and so.kind = 'contractor';
    if con is null then select array_agg(p.name order by p.created_at) into con from site_people p where p.site_id = r.site_id and p.role = 'con' and p.active and not p.backup; end if;
    select coalesce(jsonb_agg(jsonb_build_object('name', p.name, 'phone', p.phone) order by p.created_at), '[]'::jsonb) into bk
      from site_people p where p.site_id = r.site_id and p.role = 'rep' and p.backup and p.active;
  end if;
  return jsonb_build_object('site', s.name, 'address', s.address, 'role', r.role, 'status', r.status, 'expires_at', r.expires_at,
    'doc_required', invite_doc_required(r.role), 'name', case when r.status <> 'open' then r.name end,
    'email', case when r.status <> 'open' then r.email end, 'reject_reason', case when r.status = 'rejected' then r.reject_reason end,
    'site_id', case when r.role = 'rep' then s.id end, 'profile', case when r.role = 'rep' then s.profile end,
    'con', to_jsonb(coalesce(con, '{}')), 'backups', coalesce(bk, '[]'::jsonb), 'backup', r.backup);
end $$;

-- ===== 4. שליחת ההרשמה: לנציג, חתימה על הכתב היא חובה =====
drop function if exists invite_submit(text, text, text, text, text, text, text, text);
create or replace function invite_submit(p_token text, p_name text, p_phone text, p_email text, p_license text,
  p_doc text default null, p_doc_name text default null, p_ua text default null,
  p_sig text default null, p_sig_body text default null, p_sig_title text default null)
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
  if r.role = 'rep' then
    if p_sig is null or p_sig !~ '^data:image/png;base64,' or length(p_sig) > 2000000 then raise exception 'sig_required: צריך לחתום על כתב ההסמכה'; end if;
    if p_sig_body is null or length(p_sig_body) < 50 or length(p_sig_body) > 200000 then raise exception 'sig_required: צריך לחתום על כתב ההסמכה'; end if;
  end if;
  update site_invites set status = 'pending', name = left(trim(p_name), 120), phone = left(trim(p_phone), 30), email = em,
    license = left(nullif(trim(p_license), ''), 200), submitted_at = now(), user_agent = left(p_ua, 300),
    has_doc = has_doc or p_doc is not null, doc_type = coalesce(dtype, doc_type), doc_name = coalesce(left(p_doc_name, 120), doc_name),
    has_sig = has_sig or p_sig is not null
  where id = r.id;
  if p_doc is not null then
    insert into site_invite_docs (invite_id, data) values (r.id, p_doc) on conflict (invite_id) do update set data = excluded.data, created_at = now();
  end if;
  if p_sig is not null then
    insert into site_invite_sigs (invite_id, image, body, body_hash, signer_title)
    values (r.id, p_sig, p_sig_body, encode(sha256(convert_to(p_sig_body, 'UTF8')), 'hex'), left(p_sig_title, 120))
    on conflict (invite_id) do update set image = excluded.image, body = excluded.body, body_hash = excluded.body_hash, signer_title = excluded.signer_title, created_at = now();
  end if;
  return jsonb_build_object('status', 'pending');
end $$;

-- ===== 5. אישור: הנציג נכנס מהתאריך שבו חתם, והחתימה שלו נשמרת על הכתב =====
create or replace function invite_decide(p_id uuid, p_ok boolean, p_reason text default null, p_backup boolean default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r site_invites; pid uuid; g site_invite_sigs;
begin
  if not is_service_admin() then raise exception 'no_permission: רק מנהל המערכת מאשר הצטרפות'; end if;
  select * into r from site_invites where id = p_id for update;
  if r.id is null then raise exception 'not_found'; end if;
  if r.status <> 'pending' then raise exception 'not_pending: הבקשה כבר טופלה'; end if;
  if p_ok then
    select id into pid from site_people where site_id = r.site_id and role = r.role and active and lower(coalesce(email, '')) = lower(r.email) limit 1;
    if pid is null then
      insert into site_people (site_id, role, name, phone, email, license, from_date, backup, active)
      values (r.site_id, r.role, r.name, r.phone, r.email, r.license, (r.submitted_at at time zone 'Asia/Jerusalem')::date, coalesce(p_backup, r.backup), true)
      returning id into pid;
    end if;
    select * into g from site_invite_sigs where invite_id = r.id;
    if r.role = 'rep' and g.invite_id is not null then
      perform set_config('safety.invite_sig', '1', true);
      insert into signatures (site_id, doc_type, doc_ref, doc_hash, doc_snapshot, slot, signer_name, signer_title, image, signed_by_email, signed_at, user_agent)
      values (r.site_id, 'auth_letter', pid, g.body_hash, g.body, 'rep', r.name, coalesce(g.signer_title, 'נציג מבצע הבנייה באתר'), g.image,
              r.email || ' (בהרשמה דרך קישור)', r.submitted_at, r.user_agent);
      perform set_config('safety.invite_sig', '', true);
    end if;
    update site_invites set status = 'approved', person_id = pid, decided_at = now(), decided_by_email = my_email() where id = r.id;
  else
    update site_invites set status = 'rejected', reject_reason = left(nullif(trim(p_reason), ''), 500), decided_at = now(), decided_by_email = my_email() where id = r.id;
  end if;
  return jsonb_build_object('status', case when p_ok then 'approved' else 'rejected' end, 'person_id', pid);
end $$;

revoke execute on function invite_info(text), invite_submit(text, text, text, text, text, text, text, text, text, text, text) from public;
grant execute on function invite_info(text), invite_submit(text, text, text, text, text, text, text, text, text, text, text) to anon, authenticated;
revoke execute on function invite_decide(uuid, boolean, text, boolean) from public, anon;
grant execute on function invite_decide(uuid, boolean, text, boolean) to authenticated;

notify pgrst, 'reload schema';
