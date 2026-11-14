-- חבילה 1.8: ממונה בטיחות כמו מנהל עבודה, קישור צפייה למפקח עבודה, בדיקה יומית לציוד,
-- תוכנית בטיחות ונספח משאבים בתוך המערכת, חתימת עובד על הדרכה בטלפון שלו בלי כניסה למערכת.
-- להריץ פעם אחת ב-SQL Editor. בטוח להריץ שוב.

-- ===== 1. הממונה על הבטיחות רושם עובדים, נוכחות והדרכות, כמו מנהל העבודה =====
create or replace function can_register_workers(s uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select has_site_role(s, array['wm','rep','so'])
$$;
revoke execute on function can_register_workers(uuid) from public, anon;
grant execute on function can_register_workers(uuid) to authenticated;

-- ===== 2. בדיקה יומית לציוד =====
-- ציוד שנכשל בבדיקה מסומן "אסור להפעיל" עד שהליקוי שנפתח בגללו נסגר עם צילום אחרי
alter table equipment add column if not exists stop_use boolean not null default false;
alter table equipment add column if not exists stop_reason text;
alter table equipment add column if not exists stop_defect_id uuid references defects(id);
alter table equipment add column if not exists stop_at timestamptz;

alter table defects drop constraint if exists defects_source_check;
alter table defects add constraint defects_source_check check (source in ('checkin','so','bakar','sm','inspector','equipment','other'));

create table if not exists equipment_checks (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id) on delete cascade,
  equipment_id uuid not null references equipment(id),
  day date not null,
  items jsonb not null default '[]'::jsonb,
  ok boolean not null,
  note text,
  photo_path text,
  defect_id uuid references defects(id),
  checked_by_name text not null check (length(trim(checked_by_name)) >= 2),
  created_by_email text,
  created_at timestamptz not null default now(),
  constraint failed_needs_defect check (ok or defect_id is not null)
);
create index if not exists equipment_checks_eq on equipment_checks(equipment_id, day desc);
create index if not exists equipment_checks_site on equipment_checks(site_id, day desc);

create or replace function equipment_check_stamp() returns trigger language plpgsql set search_path = public as $$
declare today date := (now() at time zone 'Asia/Jerusalem')::date;
begin
  if not exists (select 1 from equipment e where e.id = new.equipment_id and e.site_id = new.site_id) then raise exception 'equipment_mismatch'; end if;
  if new.defect_id is not null and not exists (select 1 from defects d where d.id = new.defect_id and d.site_id = new.site_id) then raise exception 'defect_mismatch'; end if;
  new.created_by_email := my_email(); new.created_at := now();
  -- יום הבדיקה: היום, או עד שלושה ימים אחורה לבדיקה שנשמרה בטלפון בלי קליטה
  if new.day is null or new.day > today or new.day < today - 3 then new.day := today; end if;
  return new;
end $$;
drop trigger if exists equipment_checks_stamp on equipment_checks;
create trigger equipment_checks_stamp before insert on equipment_checks for each row execute function equipment_check_stamp();
revoke execute on function equipment_check_stamp() from public, anon, authenticated;

-- בדיקה שנכשלה: הציוד נעצר מיד
create or replace function equipment_check_after() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not new.ok then
    update equipment set stop_use = true, stop_defect_id = new.defect_id, stop_at = now(),
      stop_reason = left(coalesce(nullif(trim(new.note), ''), 'נכשל בבדיקה היומית'), 300)
    where id = new.equipment_id;
  end if;
  return null;
end $$;
drop trigger if exists equipment_checks_after on equipment_checks;
create trigger equipment_checks_after after insert on equipment_checks for each row execute function equipment_check_after();
revoke execute on function equipment_check_after() from public, anon, authenticated;

-- החזרה לשימוש רק אחרי שהליקוי נסגר
create or replace function equipment_stop_guard() returns trigger language plpgsql set search_path = public as $$
begin
  if old.stop_use and not new.stop_use then
    if old.stop_defect_id is not null and not exists (select 1 from defects d where d.id = old.stop_defect_id and d.closed_at is not null) then
      raise exception 'equipment_stopped: הציוד חוזר לשימוש רק אחרי שהליקוי נסגר עם צילום אחרי התיקון';
    end if;
    new.stop_defect_id := null; new.stop_reason := null; new.stop_at := null;
  end if;
  return new;
end $$;
drop trigger if exists equipment_stop_guard on equipment;
create trigger equipment_stop_guard before update on equipment for each row execute function equipment_stop_guard();
revoke execute on function equipment_stop_guard() from public, anon, authenticated;

drop trigger if exists equipment_checks_no_delete on equipment_checks;
create trigger equipment_checks_no_delete before delete on equipment_checks for each row execute function no_delete();
drop trigger if exists equipment_checks_no_update on equipment_checks;
create trigger equipment_checks_no_update before update on equipment_checks for each row execute function no_update();
drop trigger if exists equipment_checks_audit on equipment_checks;
create trigger equipment_checks_audit after insert on equipment_checks for each row execute function audit_row();
alter table equipment_checks enable row level security;
drop policy if exists p_ec_sel on equipment_checks;
create policy p_ec_sel on equipment_checks for select using (can_see_site(site_id));
drop policy if exists p_ec_ins on equipment_checks;
create policy p_ec_ins on equipment_checks for insert with check (has_site_role(site_id, array['con','so','sm','wm','rep']));
revoke all on equipment_checks from anon;
grant select, insert on equipment_checks to authenticated;

-- ===== 3. תוכנית בטיחות ונספח משאבים =====
-- טיוטה נערכת חופשי. מהחתימה הראשונה הנוסח ננעל; שינוי אחרי חתימה = גרסה חדשה
create table if not exists safety_plans (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id) on delete cascade,
  kind text not null check (kind in ('plan','resources')),
  version int not null default 1 check (version >= 1),
  data jsonb not null default '{}'::jsonb,
  locked_hash text,
  pdf_path text,
  pdf_at timestamptz,
  created_by_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (site_id, kind, version)
);
create or replace function safety_plan_stamp() returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.created_by_email := my_email(); new.created_at := now(); new.updated_at := now();
    new.locked_hash := null; new.pdf_path := null; new.pdf_at := null;
    return new;
  end if;
  if row(new.site_id, new.kind, new.version, new.created_by_email, new.created_at) is distinct from row(old.site_id, old.kind, old.version, old.created_by_email, old.created_at) then
    raise exception 'plan_locked';
  end if;
  -- הנעילה נקבעת רק בחתימה (signature_plan_check), לא מהדפדפן
  if old.locked_hash is null and new.locked_hash is not null and coalesce(current_setting('safety.plan_lock', true), '') <> '1' then new.locked_hash := null; end if;
  if old.locked_hash is not null and (new.data is distinct from old.data or new.locked_hash is distinct from old.locked_hash) then
    raise exception 'plan_signed: התוכנית נחתמה ואי אפשר לשנות אותה. פותחים גרסה חדשה';
  end if;
  if new.pdf_path is distinct from old.pdf_path then new.pdf_at := now(); end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists safety_plans_stamp on safety_plans;
create trigger safety_plans_stamp before insert or update on safety_plans for each row execute function safety_plan_stamp();
revoke execute on function safety_plan_stamp() from public, anon, authenticated;
drop trigger if exists safety_plans_no_delete on safety_plans;
create trigger safety_plans_no_delete before delete on safety_plans for each row execute function no_delete();
drop trigger if exists safety_plans_audit on safety_plans;
create trigger safety_plans_audit after insert or update on safety_plans for each row execute function audit_row();
alter table safety_plans enable row level security;
drop policy if exists p_sp_sel on safety_plans;
create policy p_sp_sel on safety_plans for select using (can_see_site(site_id));
drop policy if exists p_sp_ins on safety_plans;
create policy p_sp_ins on safety_plans for insert with check (case kind when 'plan' then has_site_role(site_id, array['con','so','sm','wm','rep']) else has_site_role(site_id, array['dev','con','so']) end);
drop policy if exists p_sp_upd on safety_plans;
create policy p_sp_upd on safety_plans for update using (case kind when 'plan' then has_site_role(site_id, array['con','so','sm','wm','rep']) else has_site_role(site_id, array['dev','con','so']) end)
  with check (case kind when 'plan' then has_site_role(site_id, array['con','so','sm','wm','rep']) else has_site_role(site_id, array['dev','con','so']) end);
revoke all on safety_plans from anon;
grant select, insert, update on safety_plans to authenticated;

-- חתימות על התוכנית: באותה טבלת חתימות של כתב ההסמכה. מבצע הבנייה חותם על התוכנית; על נספח המשאבים חותמים היזם ומבצע הבנייה
alter table signatures drop constraint if exists signatures_doc_type_check;
alter table signatures add constraint signatures_doc_type_check check (doc_type in ('auth_letter','safety_plan','safety_resources'));
alter table signatures drop constraint if exists signatures_slot_check;
alter table signatures add constraint signatures_slot_check check (slot in ('executor','rep','con','dev'));
drop policy if exists p_sg_ins on signatures;
create policy p_sg_ins on signatures for insert with check (case
  when doc_type = 'auth_letter' then has_site_role(site_id, array['dev','con','rep','wm','sm','so'])
  when slot = 'con' then has_site_role(site_id, array['con'])
  when slot = 'dev' then has_site_role(site_id, array['dev'])
  else false end);

create or replace function signature_plan_check() returns trigger language plpgsql security definer set search_path = public as $$
declare p safety_plans;
begin
  if new.doc_type not in ('safety_plan','safety_resources') then return new; end if;
  select * into p from safety_plans where id = new.doc_ref;
  if p.id is null or p.site_id <> new.site_id or p.kind <> (case new.doc_type when 'safety_plan' then 'plan' else 'resources' end) then raise exception 'plan_mismatch'; end if;
  if new.doc_type = 'safety_plan' and new.slot <> 'con' then raise exception 'plan_slot'; end if;
  if new.doc_type = 'safety_resources' and new.slot not in ('con','dev') then raise exception 'plan_slot'; end if;
  if p.locked_hash is not null and p.locked_hash <> new.doc_hash then raise exception 'plan_changed: הנוסח השתנה מאז החתימה הקודמת'; end if;
  if exists (select 1 from signatures g where g.doc_type = new.doc_type and g.doc_ref = new.doc_ref and g.slot = new.slot) then raise exception 'plan_signed_twice: כבר נחתם'; end if;
  perform set_config('safety.plan_lock', '1', true);
  update safety_plans set locked_hash = new.doc_hash where id = p.id and locked_hash is null;
  perform set_config('safety.plan_lock', '', true);
  return new;
end $$;
drop trigger if exists signatures_plan_check on signatures;
create trigger signatures_plan_check before insert on signatures for each row execute function signature_plan_check();
revoke execute on function signature_plan_check() from public, anon, authenticated;

-- ===== 4. קישורים בלי כניסה: צפייה למפקח עבודה, וחתימת עובד על הדרכה בטלפון שלו =====
-- בטבלה נשמרת רק טביעת אצבע של הקישור (SHA-256), לא הקישור עצמו
create table if not exists share_links (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id) on delete cascade,
  kind text not null check (kind in ('inspector','training')),
  token_hash text not null unique,
  label text,
  training_id uuid references trainings(id),
  worker_id uuid references workers(id),
  payload jsonb,
  payload_at timestamptz,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  used_at timestamptz,
  opened_at timestamptz,
  open_count int not null default 0,
  created_by_email text,
  created_at timestamptz not null default now(),
  constraint training_link_refs check (kind <> 'training' or (training_id is not null and worker_id is not null))
);
create index if not exists share_links_site on share_links(site_id, kind);
alter table share_links enable row level security;
drop policy if exists p_sl_sel on share_links;
create policy p_sl_sel on share_links for select using (case kind
  when 'inspector' then can_see_workers(site_id) or (created_by_email = my_email() and can_see_site(site_id))
  else can_see_workers(site_id) end);
revoke all on share_links from anon, authenticated;
grant select on share_links to authenticated;

create or replace function share_hash(t text) returns text language sql immutable set search_path = public as $$
  select encode(sha256(convert_to(coalesce(t, ''), 'UTF8')), 'hex')
$$;
revoke execute on function share_hash(text) from public, anon, authenticated;

-- יצירת קישור. מחזיר את הקישור פעם אחת בלבד
create or replace function share_link_create(p_kind text, p_site uuid, p_hours int, p_label text default null,
  p_training uuid default null, p_worker uuid default null, p_payload jsonb default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare tok text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''); r share_links;
begin
  if p_kind = 'inspector' then
    if not has_site_role(p_site, array['dev','bakar','con','so','sm','wm','rep']) then raise exception 'no_permission: אין לך הרשאה ליצור קישור לאתר הזה'; end if;
    if p_hours is null or p_hours < 1 or p_hours > 24 * 30 then raise exception 'bad_hours: תוקף הקישור בין שעה ל-30 יום'; end if;
    if p_payload is not null and pg_column_size(p_payload) > 3000000 then raise exception 'payload_too_big'; end if;
  elsif p_kind = 'training' then
    if not can_register_workers(p_site) then raise exception 'no_permission: רק מי שמעביר הדרכות שולח קישור לחתימה'; end if;
    if not exists (select 1 from trainings t where t.id = p_training and t.site_id = p_site and t.closed_at is null) then raise exception 'training_closed: ההדרכה נסגרה או לא נמצאה'; end if;
    if not exists (select 1 from workers w where w.id = p_worker and w.site_id = p_site and w.active) then raise exception 'worker_mismatch'; end if;
    if exists (select 1 from training_signatures g where g.training_id = p_training and g.worker_id = p_worker) then raise exception 'already_signed: העובד כבר חתם על ההדרכה'; end if;
    p_hours := least(greatest(coalesce(p_hours, 48), 1), 72);
    p_payload := null;
    -- קישור קודם לאותו עובד ואותה הדרכה מבוטל
    update share_links set revoked_at = now() where kind = 'training' and training_id = p_training and worker_id = p_worker and revoked_at is null and used_at is null;
  else raise exception 'bad_kind'; end if;
  insert into share_links (site_id, kind, token_hash, label, training_id, worker_id, payload, payload_at, expires_at, created_by_email)
  values (p_site, p_kind, share_hash(tok), left(p_label, 200), p_training, p_worker, p_payload, case when p_payload is not null then now() end,
          now() + make_interval(hours => p_hours), my_email())
  returning * into r;
  return jsonb_build_object('id', r.id, 'token', tok, 'expires_at', r.expires_at);
end $$;

-- עדכון תמונת המצב שהמפקח רואה
create or replace function share_link_snapshot(p_id uuid, p_payload jsonb) returns timestamptz
language plpgsql security definer set search_path = public as $$
declare r share_links;
begin
  select * into r from share_links where id = p_id;
  if r.id is null or r.kind <> 'inspector' then raise exception 'not_found'; end if;
  if not (can_see_workers(r.site_id) or (r.created_by_email = my_email() and can_see_site(r.site_id))) then raise exception 'no_permission'; end if;
  if r.revoked_at is not null or r.expires_at < now() then return null; end if;
  if pg_column_size(p_payload) > 3000000 then raise exception 'payload_too_big'; end if;
  update share_links set payload = p_payload, payload_at = now() where id = p_id;
  return now();
end $$;

create or replace function share_link_revoke(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r share_links;
begin
  select * into r from share_links where id = p_id;
  if r.id is null then raise exception 'not_found'; end if;
  if not (case r.kind when 'inspector' then has_site_role(r.site_id, array['dev','bakar','con','so','sm','wm','rep']) and (can_see_workers(r.site_id) or r.created_by_email = my_email())
          else can_register_workers(r.site_id) end) then raise exception 'no_permission'; end if;
  update share_links set revoked_at = now(), payload = null where id = p_id and revoked_at is null;
end $$;

-- פתיחת קישור המפקח (בלי כניסה)
create or replace function share_inspector(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r share_links;
begin
  select * into r from share_links where token_hash = share_hash(p_token) and kind = 'inspector';
  if r.id is null or r.revoked_at is not null or r.expires_at < now() then raise exception 'link_invalid: הקישור לא בתוקף. אפשר לבקש קישור חדש מהאתר'; end if;
  update share_links set opened_at = coalesce(opened_at, now()), open_count = open_count + 1 where id = r.id;
  return jsonb_build_object('site', (select name from sites where id = r.site_id), 'label', r.label, 'expires_at', r.expires_at,
    'payload', r.payload, 'payload_at', r.payload_at);
end $$;

-- פתיחת קישור החתימה של העובד (בלי כניסה). מספר התעודה מוצג מוסתר
create or replace function share_training(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r share_links; t trainings; w workers; s sites; g training_signatures;
begin
  select * into r from share_links where token_hash = share_hash(p_token) and kind = 'training';
  if r.id is null or r.revoked_at is not null then raise exception 'link_invalid: הקישור לא בתוקף. צריך לבקש קישור חדש ממנהל העבודה'; end if;
  select * into t from trainings where id = r.training_id;
  select * into w from workers where id = r.worker_id;
  select * into s from sites where id = r.site_id;
  select * into g from training_signatures where training_id = t.id and worker_id = w.id;
  if g.id is null and (r.expires_at < now() or t.closed_at is not null) then raise exception 'link_invalid: הקישור לא בתוקף. צריך לבקש קישור חדש ממנהל העבודה'; end if;
  update share_links set opened_at = coalesce(opened_at, now()), open_count = open_count + 1 where id = r.id;
  return jsonb_build_object('site', s.name, 'expires_at', r.expires_at,
    'training', jsonb_build_object('kind', t.kind, 'topic', t.topic, 'trainer_name', t.trainer_name, 'trainer_title', t.trainer_title, 'language', t.language, 'held_at', t.held_at),
    'worker', jsonb_build_object('name', w.name, 'id_type', w.id_type, 'id_masked', repeat('•', greatest(length(w.id_number) - 3, 0)) || right(w.id_number, 3), 'language', w.language),
    'signed_at', g.signed_at);
end $$;

-- חתימת העובד דרך הקישור. הנוסח בעברית נבנה בשרת עם מספר התעודה המלא; בנוסח בשפת העובד {{ID}} מוחלף במספר
create or replace function share_training_sign(p_token text, p_image text, p_local text default null, p_lang text default null,
  p_client_at timestamptz default null, p_ua text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r share_links; t trainings; w workers; s sites; kind_he text; st text; g training_signatures;
begin
  select * into r from share_links where token_hash = share_hash(p_token) and kind = 'training' for update;
  if r.id is null or r.revoked_at is not null or r.used_at is not null or r.expires_at < now() then raise exception 'link_invalid: הקישור לא בתוקף. צריך לבקש קישור חדש ממנהל העבודה'; end if;
  if p_image is null or p_image not like 'data:image/png;base64,%' or length(p_image) > 400000 then raise exception 'bad_image: החתימה לא נקלטה. צריך לחתום שוב'; end if;
  select * into t from trainings where id = r.training_id;
  select * into w from workers where id = r.worker_id;
  select * into s from sites where id = r.site_id;
  kind_he := case t.kind when 'intro' then 'הדרכה לעובד חדש לפני תחילת עבודה' when 'annual' then 'הדרכת בטיחות שנתית' when 'height' then 'הדרכה לעבודה בגובה'
    when 'toolbox' then 'תדריך בטיחות (שיחת בוקר)' else 'הדרכה אחרת' end;
  st := format('אני, %s, %s %s, מאשר/ת שהיום, %s, קיבלתי %s באתר %s, בנושא: %s. ההדרכה ניתנה פנים אל פנים בידי %s, בשפה שאני מבין/ה (%s), והבנתי אותה. (נחתם בטלפון של העובד דרך קישור אישי)',
    w.name, case when w.id_type = 'passport' then 'דרכון' else 'ת"ז' end, w.id_number, to_char(now() at time zone 'Asia/Jerusalem', 'FMDD.FMMM.YYYY'), kind_he, s.name, t.topic, t.trainer_name, coalesce(t.language, '—'));
  perform set_config('safety.sig_via', 'קישור אישי בטלפון העובד', true);
  insert into training_signatures (training_id, site_id, worker_id, worker_name, statement, statement_local, lang, image, client_signed_at, user_agent)
  values (t.id, s.id, w.id, w.name, st, case when p_local is not null and p_lang is not null then replace(left(p_local, 2000), '{{ID}}', w.id_number) end,
          case when p_local is not null then left(p_lang, 5) end, p_image, p_client_at, left(p_ua, 300))
  returning * into g;
  update share_links set used_at = now() where id = r.id;
  return jsonb_build_object('signed_at', g.signed_at);
end $$;

-- חותמת השרת על חתימת עובד: בחתימה דרך קישור אין משתמש מחובר, ולכן נרשם "קישור אישי"
create or replace function training_sig_stamp() returns trigger language plpgsql set search_path = public as $$
declare t trainings;
begin
  select * into t from trainings where id = new.training_id;
  if t.id is null or t.site_id <> new.site_id then raise exception 'training_mismatch'; end if;
  if t.closed_at is not null then raise exception 'training_closed: ההדרכה נסגרה ואי אפשר להוסיף חתימות'; end if;
  if not exists (select 1 from workers w where w.id = new.worker_id and w.site_id = new.site_id and w.active) then raise exception 'worker_mismatch'; end if;
  new.signed_at := now(); new.created_at := now();
  new.signed_by_email := coalesce(nullif(my_email(), ''), nullif(current_setting('safety.sig_via', true), ''), '');
  if new.client_signed_at is not null and (new.client_signed_at > now() + interval '5 minutes' or new.client_signed_at < now() - interval '3 days') then
    new.client_signed_at := null;
  end if;
  return new;
end $$;
revoke execute on function training_sig_stamp() from public, anon, authenticated;

revoke execute on function share_link_create(text, uuid, int, text, uuid, uuid, jsonb), share_link_snapshot(uuid, jsonb), share_link_revoke(uuid) from public, anon;
grant execute on function share_link_create(text, uuid, int, text, uuid, uuid, jsonb), share_link_snapshot(uuid, jsonb), share_link_revoke(uuid) to authenticated;
revoke execute on function share_inspector(text), share_training(text), share_training_sign(text, text, text, text, timestamptz, text) from public;
grant execute on function share_inspector(text), share_training(text), share_training_sign(text, text, text, text, timestamptz, text) to anon, authenticated;

-- ===== 5. דוח חודשי ליזם: מספרים מצטברים בלבד (בלי פרטי עובדים) לכל מי שרואה את האתר =====
create or replace function site_month_counts(p_site uuid, p_from date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare out jsonb := '{}'::jsonb; m date;
begin
  if not can_see_site(p_site) then raise exception 'no_permission'; end if;
  m := date_trunc('month', p_from)::date;
  while m <= (now() at time zone 'Asia/Jerusalem')::date loop
    out := out || jsonb_build_object(to_char(m, 'YYYY-MM'), jsonb_build_object(
      'worker_days', (select count(*) from attendance a where a.site_id = p_site and a.present and a.day >= m and a.day < (m + interval '1 month')::date),
      'work_days', (select count(distinct a.day) from attendance a where a.site_id = p_site and a.present and a.day >= m and a.day < (m + interval '1 month')::date),
      'trainings', (select count(*) from trainings t where t.site_id = p_site and date_trunc('month', t.held_at at time zone 'Asia/Jerusalem')::date = m),
      'training_sigs', (select count(*) from training_signatures g where g.site_id = p_site and date_trunc('month', g.signed_at at time zone 'Asia/Jerusalem')::date = m),
      'new_workers', (select count(*) from workers w where w.site_id = p_site and date_trunc('month', w.created_at at time zone 'Asia/Jerusalem')::date = m)));
    m := (m + interval '1 month')::date;
  end loop;
  return out;
end $$;
revoke execute on function site_month_counts(uuid, date) from public, anon;
grant execute on function site_month_counts(uuid, date) to authenticated;

notify pgrst, 'reload schema';
