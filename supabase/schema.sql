-- גרושר · ניהול בטיחות באתר · מסד נתונים (Supabase / PostgreSQL)
-- מריצים פעם אחת ב-SQL Editor של פרויקט Supabase חדש ונפרד (לא בפרויקט של מערכת קבלני המשנה: יש שמות טבלאות משותפים).
-- אפשר להריץ שוב בלי נזק (if not exists / or replace).

do $$ begin
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'tenants') then
    raise exception 'נראה שזה הפרויקט של מערכת קבלני המשנה. צריך פרויקט Supabase חדש ונפרד למערכת הבטיחות.';
  end if;
end $$;

create extension if not exists pgcrypto;

-- ===== טבלאות =====
create table if not exists profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text,
  is_service_admin boolean not null default false,
  created_at timestamptz not null default now()
);

-- ארגון: יזם, קבלן ראשי, יועץ
create table if not exists orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null check (kind in ('developer','contractor','consultant')),
  reg_no text,
  contractor_reg text,
  demo boolean not null default false,
  created_at timestamptz not null default now()
);

-- שיוך משתמש לארגון לפי אימייל (אפשר להוסיף לפני שהמשתמש נרשם)
create table if not exists memberships (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  email text not null,
  org_admin boolean not null default false,
  created_at timestamptz not null default now(),
  unique (org_id, email)
);

create table if not exists sites (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text,
  profile jsonb not null default '{}',           -- הפרופיל המשפטי מאשף התחולה
  status text not null default 'planning' check (status in ('planning','approved','active','stopped','closed_order','done')),
  demo boolean not null default false,
  created_by text default lower(coalesce(auth.jwt()->>'email','')),
  created_at timestamptz not null default now()
);

create table if not exists site_orgs (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id) on delete cascade,
  org_id uuid not null references orgs(id) on delete restrict,
  kind text not null check (kind in ('developer','contractor','consultant')),
  created_at timestamptz not null default now(),
  unique (site_id, org_id)
);

-- בעלי תפקידים באתר (נמעני ההתראות)
create table if not exists site_people (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id) on delete cascade,
  role text not null check (role in ('dev','bakar','con','so','sm','wm','rep','fa','sub','viewer')),
  name text not null,
  phone text,
  email text,
  license text,
  from_date date,
  to_date date,
  backup boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists site_people_site on site_people(site_id);
create index if not exists site_people_email on site_people(lower(email));

create table if not exists events (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id) on delete cascade,
  type text not null,
  occurred_at timestamptz not null,
  description text,
  reported_by text,
  created_at timestamptz not null default now()
);
create index if not exists events_site on events(site_id, occurred_at desc);

-- מופעי חובה: לא נמחקים אף פעם. נסגרים כבוצע (עם ראיה), לא חל או דחייה מוצדקת (עם נימוק)
create table if not exists duties (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id) on delete cascade,
  key text not null,
  side text not null check (side in ('dev','con')),
  holder text not null,
  kind text not null,
  title text not null,
  ref text,
  critical boolean not null default false,
  due_at timestamptz,
  status text not null default 'open' check (status in ('open','done','na','waived')),
  event_id uuid references events(id),
  seq int not null default 1,
  auto boolean not null default true,
  done_at timestamptz,
  closed_at timestamptz,
  done_by text,
  evidence_note text,
  evidence_ref text,
  file_path text,
  na_reason text,
  created_at timestamptz not null default now(),
  constraint done_needs_evidence check (status <> 'done' or (coalesce(evidence_note,'') <> '' and (coalesce(evidence_ref,'') <> '' or file_path is not null) ) or auto is false),
  constraint closed_needs_reason check (status not in ('na','waived') or coalesce(na_reason,'') <> '')
);
create index if not exists duties_site on duties(site_id, status);

-- יומן שליחה: WhatsApp נרשם "נפתח לשליחה" (opened), לא "נמסר"
create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id) on delete cascade,
  duty_id uuid references duties(id),
  level text,
  channel text not null check (channel in ('whatsapp','email')),
  status text not null,
  recipient_name text,
  recipient text,
  person_id uuid,
  sent_at timestamptz not null default now(),
  sent_by text,
  created_at timestamptz not null default now()
);
create index if not exists notifications_duty on notifications(duty_id);

-- צ'ק-אין יומי והשגחה באתר (מנהל עבודה או נציג מבצע הבנייה). לא נמחק ולא משתנה
create table if not exists checkins (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id) on delete cascade,
  duty_id uuid references duties(id),
  day int not null,
  person_id uuid references site_people(id),
  person_name text not null,
  role text,
  backup boolean not null default false,
  at timestamptz not null default now(),
  lat double precision,
  lng double precision,
  accuracy int,
  checks jsonb not null default '{}',
  note text,
  by text,
  created_at timestamptz not null default now()
);
create index if not exists checkins_site on checkins(site_id, at desc);

create table if not exists audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  user_email text,
  table_name text not null,
  row_id uuid,
  site_id uuid,
  action text not null,
  old_data jsonb,
  new_data jsonb
);
create index if not exists audit_site on audit_log(site_id, at desc);

-- התקנה קיימת (חבילה 1 / 1.1): מוסיפים את תפקיד נציג מבצע הבנייה
alter table site_people drop constraint if exists site_people_role_check;
alter table site_people add constraint site_people_role_check check (role in ('dev','bakar','con','so','sm','wm','rep','fa','sub','viewer'));

-- ===== פונקציות הרשאה =====
create or replace function my_email() returns text language sql stable as $$
  select lower(coalesce(auth.jwt()->>'email',''))
$$;

create or replace function is_service_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_service_admin from profiles where user_id = auth.uid()), false)
$$;

-- התפקידים של המשתמש באתר: לפי ארגון (יזם / קבלן) ולפי שיוך אישי ברשימת בעלי התפקידים
create or replace function my_site_roles(s uuid) returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct r), '{}') from (
    select case so.kind when 'developer' then 'dev' when 'contractor' then 'con' else 'viewer' end as r
      from site_orgs so join memberships m on m.org_id = so.org_id
      where so.site_id = s and lower(m.email) = my_email()
    union all
    select sp.role from site_people sp where sp.site_id = s and sp.active and lower(coalesce(sp.email,'')) = my_email() and my_email() <> ''
    union all
    select 'dev' from sites x where x.id = s and x.created_by = my_email() and my_email() <> ''
  ) t
$$;

create or replace function can_see_site(s uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select is_service_admin() or cardinality(my_site_roles(s)) > 0
$$;
create or replace function has_site_role(s uuid, roles text[]) returns boolean
language sql stable security definer set search_path = public as $$
  select is_service_admin() or my_site_roles(s) && roles
$$;
create or replace function role_side(r text) returns text language sql immutable as $$
  select case when r in ('dev','bakar','viewer') then 'dev' else 'con' end
$$;
-- חבר בארגון יזם (רשאי לפתוח אתר חדש)
create or replace function is_developer_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from memberships m join orgs o on o.id = m.org_id where o.kind = 'developer' and lower(m.email) = my_email())
$$;

-- פרופיל נוצר בהרשמה
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles(user_id, email) values (new.id, lower(new.email)) on conflict do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function handle_new_user();

-- המשתמשת הראשונה שנרשמת הופכת למנהלת השירות (רק אם עדיין אין כזו)
create or replace function claim_service_admin() returns boolean
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles(user_id, email) select id, lower(email) from auth.users where id = auth.uid() on conflict do nothing;
  if exists (select 1 from profiles where is_service_admin) then return is_service_admin(); end if;
  update profiles set is_service_admin = true where user_id = auth.uid();
  return true;
end $$;

-- ===== כללים =====
-- אותו אדם לא יכול לכהן בשני תפקידים שהתקנות מפרידות ביניהם (תקנות 2א(א)(2), 2ב(א)(2))
create or replace function check_role_conflict() returns trigger
language plpgsql security definer set search_path = public as $$
declare bad text[];
begin
  if not new.active then return new; end if;
  bad := case new.role when 'bakar' then array['wm','sm','so','rep'] when 'sm' then array['wm','bakar'] when 'wm' then array['bakar','sm'] when 'so' then array['bakar'] when 'rep' then array['bakar'] else array[]::text[] end;
  if exists (select 1 from site_people p where p.site_id = new.site_id and p.id <> new.id and p.active and p.role = any(bad)
      and ((coalesce(p.email,'') <> '' and lower(p.email) = lower(coalesce(new.email,'')))
        or (coalesce(p.phone,'') <> '' and regexp_replace(p.phone,'\D','','g') = regexp_replace(coalesce(new.phone,''),'\D','','g'))
        or trim(p.name) = trim(new.name))) then
    raise exception 'role_conflict';
  end if;
  return new;
end $$;
drop trigger if exists site_people_conflict on site_people;
create trigger site_people_conflict before insert or update on site_people for each row execute function check_role_conflict();

create or replace function no_delete() returns trigger language plpgsql as $$
begin raise exception 'no_delete'; end $$;
do $$ declare t text; begin
  foreach t in array array['duties','events','notifications','audit_log','checkins'] loop
    execute format('drop trigger if exists %I_no_delete on %I', t, t);
    execute format('create trigger %I_no_delete before delete on %I for each row execute function no_delete()', t, t);
  end loop;
end $$;

-- יומן ביקורת: אי אפשר לשנות רשומה קיימת
create or replace function no_update() returns trigger language plpgsql as $$
begin raise exception 'no_delete'; end $$;
drop trigger if exists audit_no_update on audit_log;
create trigger audit_no_update before update on audit_log for each row execute function no_update();

-- כל שינוי נרשם ביומן
create or replace function audit_row() returns trigger
language plpgsql security definer set search_path = public as $$
declare r jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
begin
  insert into audit_log(user_email, table_name, row_id, site_id, action, old_data, new_data)
  values (my_email(), tg_table_name, (r->>'id')::uuid,
          case when tg_table_name = 'sites' then (r->>'id')::uuid else nullif(r->>'site_id','')::uuid end,
          lower(tg_op), case when tg_op <> 'INSERT' then to_jsonb(old) end, case when tg_op <> 'DELETE' then to_jsonb(new) end);
  return null;
end $$;
do $$ declare t text; begin
  foreach t in array array['orgs','memberships','sites','site_orgs','site_people','duties','events','checkins'] loop
    execute format('drop trigger if exists %I_audit on %I', t, t);
    execute format('create trigger %I_audit after insert or update or delete on %I for each row execute function audit_row()', t, t);
  end loop;
end $$;

-- ===== RLS =====
alter table profiles enable row level security;
alter table orgs enable row level security;
alter table memberships enable row level security;
alter table sites enable row level security;
alter table site_orgs enable row level security;
alter table site_people enable row level security;
alter table events enable row level security;
alter table duties enable row level security;
alter table notifications enable row level security;
alter table audit_log enable row level security;
alter table checkins enable row level security;

drop policy if exists p_profiles on profiles;
create policy p_profiles on profiles for select using (user_id = auth.uid() or is_service_admin());

-- ארגונים: רואים את הארגון שלך ואת הארגונים באתרים שלך. יוצרים ועורכים: מנהלת השירות
drop policy if exists p_orgs_sel on orgs;
create policy p_orgs_sel on orgs for select using (is_service_admin()
  or exists (select 1 from memberships m where m.org_id = orgs.id and lower(m.email) = my_email())
  or exists (select 1 from site_orgs so where so.org_id = orgs.id and can_see_site(so.site_id)));
drop policy if exists p_orgs_all on orgs;
create policy p_orgs_all on orgs for all using (is_service_admin()) with check (is_service_admin());

drop policy if exists p_mem_sel on memberships;
create policy p_mem_sel on memberships for select using (is_service_admin() or lower(email) = my_email());
drop policy if exists p_mem_all on memberships;
create policy p_mem_all on memberships for all using (is_service_admin()) with check (is_service_admin());

-- אתרים: יוצרים מנהלת השירות או חבר בארגון יזם. עורכים פרופיל: צד היזם
drop policy if exists p_sites_sel on sites;
create policy p_sites_sel on sites for select using (can_see_site(id) or created_by = my_email());
drop policy if exists p_sites_ins on sites;
create policy p_sites_ins on sites for insert with check (is_service_admin() or is_developer_member());
drop policy if exists p_sites_upd on sites;
create policy p_sites_upd on sites for update using (has_site_role(id, array['dev'])) with check (has_site_role(id, array['dev']));
drop policy if exists p_sites_del on sites;
create policy p_sites_del on sites for delete using (is_service_admin());

drop policy if exists p_so_sel on site_orgs;
create policy p_so_sel on site_orgs for select using (can_see_site(site_id));
drop policy if exists p_so_all on site_orgs;
create policy p_so_all on site_orgs for all using (has_site_role(site_id, array['dev'])) with check (has_site_role(site_id, array['dev']));

-- בעלי תפקידים: היזם ממנה את תפקידי צד היזם (כולל בקר), הקבלן את תפקידי צד הקבלן
drop policy if exists p_sp_sel on site_people;
create policy p_sp_sel on site_people for select using (can_see_site(site_id));
drop policy if exists p_sp_all on site_people;
create policy p_sp_all on site_people for all
  using (has_site_role(site_id, array[case when role_side(role) = 'dev' then 'dev' else 'con' end]))
  with check (has_site_role(site_id, array[case when role_side(role) = 'dev' then 'dev' else 'con' end]));

-- חובות ואירועים: כל בעל תפקיד פעיל באתר (חוץ מצופה) יוצר ומעדכן. ההגבלה למי רשאי לסגור איזו חובה נעשית במסך.
drop policy if exists p_d_sel on duties;
create policy p_d_sel on duties for select using (can_see_site(site_id));
drop policy if exists p_d_ins on duties;
create policy p_d_ins on duties for insert with check (has_site_role(site_id, array['dev','bakar','con','so','sm','wm','rep']));
drop policy if exists p_d_upd on duties;
create policy p_d_upd on duties for update using (has_site_role(site_id, array['dev','bakar','con','so','sm','wm','rep'])) with check (has_site_role(site_id, array['dev','bakar','con','so','sm','wm','rep']));

drop policy if exists p_e_sel on events;
create policy p_e_sel on events for select using (can_see_site(site_id));
drop policy if exists p_e_ins on events;
create policy p_e_ins on events for insert with check (has_site_role(site_id, array['dev','bakar','con','so','sm','wm','rep']));

drop policy if exists p_n_sel on notifications;
create policy p_n_sel on notifications for select using (can_see_site(site_id));
drop policy if exists p_n_ins on notifications;
create policy p_n_ins on notifications for insert with check (can_see_site(site_id));

drop policy if exists p_c_sel on checkins;
create policy p_c_sel on checkins for select using (can_see_site(site_id));
drop policy if exists p_c_ins on checkins;
create policy p_c_ins on checkins for insert with check (has_site_role(site_id, array['con','wm','rep']));
-- אין עדכון ואין מחיקה של צ'ק-אין
drop trigger if exists checkins_no_update on checkins;
create trigger checkins_no_update before update on checkins for each row execute function no_update();

drop policy if exists p_a_sel on audit_log;
create policy p_a_sel on audit_log for select using (is_service_admin() or (site_id is not null and can_see_site(site_id)));

-- ===== קבצי ראיה: תיקייה ראשונה בנתיב = מזהה האתר =====
insert into storage.buckets (id, name, public, file_size_limit) values ('files', 'files', false, 26214400) on conflict (id) do nothing;
drop policy if exists safety_files_sel on storage.objects;
create policy safety_files_sel on storage.objects for select to authenticated using (bucket_id = 'files' and can_see_site(((storage.foldername(name))[1])::uuid));
drop policy if exists safety_files_ins on storage.objects;
create policy safety_files_ins on storage.objects for insert to authenticated with check (bucket_id = 'files'
  and has_site_role(((storage.foldername(name))[1])::uuid, array['dev','bakar','con','so','sm','wm','rep']));
-- אין מחיקת קבצי ראיה (אין מדיניות delete)

grant execute on function claim_service_admin() to authenticated;
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
revoke all on all tables in schema public from anon;

-- הקשחה: search_path קבוע, ופונקציות ההרשאה לא נגישות למי שלא מחובר
alter function my_email() set search_path = public;
alter function role_side(text) set search_path = public;
alter function no_delete() set search_path = public;
alter function no_update() set search_path = public;
revoke execute on function audit_row(), check_role_conflict(), handle_new_user(), claim_service_admin(), can_see_site(uuid), has_site_role(uuid, text[]), is_developer_member(), is_service_admin(), my_site_roles(uuid) from public, anon;
revoke execute on function audit_row(), check_role_conflict(), handle_new_user() from authenticated;
grant execute on function claim_service_admin(), can_see_site(uuid), has_site_role(uuid, text[]), is_developer_member(), is_service_admin(), my_site_roles(uuid) to authenticated;
-- הודעות רשמיות שממתינות לאישור (חבילה 1.3). טיוטה ← אישור ← שליחה. אין מחיקה; כל שינוי נרשם ביומן.
create table if not exists notices (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id) on delete cascade,
  duty_id uuid references duties(id),
  key text not null,
  channel text not null check (channel in ('gov','email','letter')),
  status text not null default 'draft' check (status in ('draft','approved','sent','cancelled')),
  title text,
  to_list jsonb not null default '[]',
  subject text,
  body text,
  fields jsonb not null default '[]',
  approved_by text,
  approved_at timestamptz,
  sent_by text,
  sent_at timestamptz,
  sent_ref text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- שום הודעה לא נרשמת כנשלחה בלי אישור
  constraint sent_needs_approval check (status <> 'sent' or approved_at is not null)
);
create index if not exists notices_duty on notices(duty_id);
create index if not exists notices_site on notices(site_id);

drop trigger if exists notices_no_delete on notices;
create trigger notices_no_delete before delete on notices for each row execute function no_delete();
-- הודעה שנשלחה נעולה
create or replace function notice_lock() returns trigger language plpgsql set search_path = public as $$
begin
  if old.status = 'sent' then raise exception 'notice_sent_locked'; end if;
  return new;
end $$;
drop trigger if exists notices_lock on notices;
create trigger notices_lock before update on notices for each row execute function notice_lock();
drop trigger if exists notices_audit on notices;
create trigger notices_audit after insert or update on notices for each row execute function audit_row();

alter table notices enable row level security;
drop policy if exists p_nt_sel on notices;
create policy p_nt_sel on notices for select using (can_see_site(site_id));
drop policy if exists p_nt_ins on notices;
create policy p_nt_ins on notices for insert with check (has_site_role(site_id, array['dev','bakar','con','so','sm','wm','rep']));
drop policy if exists p_nt_upd on notices;
create policy p_nt_upd on notices for update using (has_site_role(site_id, array['dev','bakar','con','so','sm','wm','rep'])) with check (has_site_role(site_id, array['dev','bakar','con','so','sm','wm','rep']));
revoke all on notices from anon;
grant select, insert, update on notices to authenticated;
revoke execute on function notice_lock() from public, anon, authenticated;
-- חתימות במערכת (חבילה 1.4): כתב הסמכה לנציג מבצע הבנייה. חתימה לא נערכת ולא נמחקת.
-- כל חתימה שומרת את נוסח המסמך ואת טביעת האצבע שלו (SHA-256), כדי שאפשר יהיה להוכיח על מה נחתם.
create table if not exists signatures (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id) on delete cascade,
  doc_type text not null check (doc_type in ('auth_letter')),
  doc_ref uuid not null,
  doc_hash text not null,
  doc_snapshot text not null,
  slot text not null check (slot in ('executor','rep')),
  signer_name text not null,
  signer_title text,
  image text not null,
  signed_by_email text default lower(coalesce(auth.jwt()->>'email','')),
  signed_at timestamptz not null default now(),
  user_agent text,
  lat double precision,
  lng double precision,
  created_at timestamptz not null default now()
);
create index if not exists signatures_doc on signatures(doc_type, doc_ref);
create trigger signatures_no_delete before delete on signatures for each row execute function no_delete();
create trigger signatures_no_update before update on signatures for each row execute function no_update();
create trigger signatures_audit after insert on signatures for each row execute function audit_row();
alter table signatures enable row level security;
create policy p_sg_sel on signatures for select using (can_see_site(site_id));
create policy p_sg_ins on signatures for insert with check (has_site_role(site_id, array['dev','con','rep','wm','sm','so']));
revoke all on signatures from anon;
grant select, insert on signatures to authenticated;
-- מי חתם ומתי נקבעים בשרת, לא בדפדפן
create or replace function signature_stamp() returns trigger language plpgsql set search_path = public as $$
begin
  new.signed_by_email := my_email();
  new.signed_at := now();
  new.created_at := now();
  return new;
end $$;
create trigger signatures_stamp before insert on signatures for each row execute function signature_stamp();
revoke execute on function signature_stamp() from public, anon, authenticated;
-- פנקס עובדים, הדרכות עם חתימות, ציוד ותסקירים (חבילה 1.5)
-- עובדים לא נכנסים למערכת. מי שרושם עובדים: מנהל עבודה, נציג מבצע הבנייה, או מנהל השירות.
-- תעודה מזהה מלאה וצילום שלה חובה. אסור לרשום עובד מתחת לגיל 18 (נבדק גם בשרת).

-- מי רואה את פנקס העובדים: צד הקבלן ובקר הבטיחות (לא היזם, בגלל מספרי תעודות וצילומים)
create or replace function can_see_workers(s uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select has_site_role(s, array['con','so','sm','wm','rep','bakar'])
$$;
-- מי רושם עובדים ומעביר הדרכות
create or replace function can_register_workers(s uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select has_site_role(s, array['wm','rep'])
$$;
revoke execute on function can_see_workers(uuid), can_register_workers(uuid) from public, anon;
grant execute on function can_see_workers(uuid), can_register_workers(uuid) to authenticated;

create table if not exists workers (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id) on delete cascade,
  name text not null,
  id_type text not null check (id_type in ('il','passport')),
  id_number text not null check (length(trim(id_number)) >= 5),
  id_photo_path text not null,
  birth_date date not null,
  company text,
  trade text,
  phone text,
  foreign_worker boolean not null default false,
  nationality text,
  entry_date date,
  permit_no text,
  permit_until date,
  f8_date date,
  f8_institution text,
  f8_path text,
  height boolean not null default false,
  height_until date,
  height_path text,
  active boolean not null default true,
  added_by_email text,
  created_at timestamptz not null default now(),
  constraint foreign_needs_entry check (not foreign_worker or (entry_date is not null and permit_until is not null)),
  constraint height_needs_cert check (not height or (height_until is not null and height_path is not null))
);
create index if not exists workers_site on workers(site_id);
create unique index if not exists workers_site_id_number on workers(site_id, id_type, id_number);

-- גיל 18 ומעלה, ומי רשם: נקבעים בשרת
create or replace function worker_check() returns trigger language plpgsql set search_path = public as $$
begin
  if new.birth_date > (current_date - interval '18 years')::date then
    raise exception 'under_18: אסור להעסיק באתר בנייה עובד מתחת לגיל 18';
  end if;
  if tg_op = 'INSERT' then
    new.added_by_email := my_email();
    new.created_at := now();
  else
    new.added_by_email := old.added_by_email;
    new.created_at := old.created_at;
  end if;
  return new;
end $$;
drop trigger if exists workers_check on workers;
create trigger workers_check before insert or update on workers for each row execute function worker_check();
revoke execute on function worker_check() from public, anon, authenticated;
drop trigger if exists workers_no_delete on workers;
create trigger workers_no_delete before delete on workers for each row execute function no_delete();
drop trigger if exists workers_audit on workers;
create trigger workers_audit after insert or update on workers for each row execute function audit_row();
alter table workers enable row level security;
drop policy if exists p_w_sel on workers;
create policy p_w_sel on workers for select using (can_see_workers(site_id));
drop policy if exists p_w_ins on workers;
create policy p_w_ins on workers for insert with check (can_register_workers(site_id));
drop policy if exists p_w_upd on workers;
create policy p_w_upd on workers for update using (can_register_workers(site_id)) with check (can_register_workers(site_id));
revoke all on workers from anon;
grant select, insert, update on workers to authenticated;

-- הדרכות
create table if not exists trainings (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id) on delete cascade,
  kind text not null check (kind in ('annual','intro','height','toolbox','other')),
  topic text not null,
  trainer_name text not null,
  trainer_title text,
  language text,
  content text,
  held_at timestamptz not null default now(),
  pdf_path text,
  pdf_at timestamptz,
  trainer_sig text,
  closed_at timestamptz,
  created_by_email text,
  created_at timestamptz not null default now()
);
create index if not exists trainings_site on trainings(site_id);
create or replace function training_stamp() returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.created_by_email := my_email(); new.created_at := now(); new.held_at := least(coalesce(new.held_at, now()), now());
  else
    -- אחרי ההדרכה משנים רק את קובץ ה-PDF ואת הסגירה
    if row(new.site_id, new.kind, new.topic, new.trainer_name, new.trainer_title, new.language, new.content, new.held_at, new.created_by_email, new.created_at)
       is distinct from row(old.site_id, old.kind, old.topic, old.trainer_name, old.trainer_title, old.language, old.content, old.held_at, old.created_by_email, old.created_at) then
      raise exception 'training_locked: אי אפשר לשנות פרטי הדרכה אחרי שנפתחה';
    end if;
    if old.closed_at is not null and (new.closed_at is distinct from old.closed_at or new.trainer_sig is distinct from old.trainer_sig) then raise exception 'training_locked'; end if;
    if new.closed_at is not null and old.closed_at is null and coalesce(new.trainer_sig, '') = '' then raise exception 'training_needs_trainer_sig'; end if;
    if new.pdf_path is distinct from old.pdf_path then new.pdf_at := now(); end if;
    if new.closed_at is not null and old.closed_at is null then new.closed_at := now(); end if;
  end if;
  return new;
end $$;
drop trigger if exists trainings_stamp on trainings;
create trigger trainings_stamp before insert or update on trainings for each row execute function training_stamp();
revoke execute on function training_stamp() from public, anon, authenticated;
drop trigger if exists trainings_no_delete on trainings;
create trigger trainings_no_delete before delete on trainings for each row execute function no_delete();
drop trigger if exists trainings_audit on trainings;
create trigger trainings_audit after insert or update on trainings for each row execute function audit_row();
alter table trainings enable row level security;
drop policy if exists p_t_sel on trainings;
create policy p_t_sel on trainings for select using (can_see_workers(site_id));
drop policy if exists p_t_ins on trainings;
create policy p_t_ins on trainings for insert with check (can_register_workers(site_id));
drop policy if exists p_t_upd on trainings;
create policy p_t_upd on trainings for update using (can_register_workers(site_id)) with check (can_register_workers(site_id));
revoke all on trainings from anon;
grant select, insert, update on trainings to authenticated;

-- חתימת עובד על קבלת הדרכה: לא נערכת ולא נמחקת. השעה והמשתמש שהחזיק את הטלפון נקבעים בשרת
create table if not exists training_signatures (
  id uuid primary key default gen_random_uuid(),
  training_id uuid not null references trainings(id),
  site_id uuid not null references sites(id) on delete cascade,
  worker_id uuid not null references workers(id),
  worker_name text not null,
  statement text not null,
  image text not null,
  signed_at timestamptz not null default now(),
  signed_by_email text,
  user_agent text,
  created_at timestamptz not null default now(),
  unique (training_id, worker_id)
);
create index if not exists training_sigs_t on training_signatures(training_id);
create index if not exists training_sigs_w on training_signatures(worker_id);
create or replace function training_sig_stamp() returns trigger language plpgsql set search_path = public as $$
declare t trainings;
begin
  select * into t from trainings where id = new.training_id;
  if t.id is null or t.site_id <> new.site_id then raise exception 'training_mismatch'; end if;
  if t.closed_at is not null then raise exception 'training_closed: ההדרכה נסגרה ואי אפשר להוסיף חתימות'; end if;
  if not exists (select 1 from workers w where w.id = new.worker_id and w.site_id = new.site_id and w.active) then raise exception 'worker_mismatch'; end if;
  new.signed_at := now(); new.created_at := now(); new.signed_by_email := my_email();
  return new;
end $$;
drop trigger if exists training_sigs_stamp on training_signatures;
create trigger training_sigs_stamp before insert on training_signatures for each row execute function training_sig_stamp();
revoke execute on function training_sig_stamp() from public, anon, authenticated;
drop trigger if exists training_sigs_no_delete on training_signatures;
create trigger training_sigs_no_delete before delete on training_signatures for each row execute function no_delete();
drop trigger if exists training_sigs_no_update on training_signatures;
create trigger training_sigs_no_update before update on training_signatures for each row execute function no_update();
-- בלי יומן ביקורת לחתימות: השורה עצמה לא ניתנת לשינוי, והשעה והמשתמש נקבעו בשרת
alter table training_signatures enable row level security;
drop policy if exists p_ts_sel on training_signatures;
create policy p_ts_sel on training_signatures for select using (can_see_workers(site_id));
drop policy if exists p_ts_ins on training_signatures;
create policy p_ts_ins on training_signatures for insert with check (can_register_workers(site_id));
revoke all on training_signatures from anon;
grant select, insert on training_signatures to authenticated;

-- ציוד ותסקירים: כל בדיקה נשמרת כשורה נפרדת (היסטוריה מלאה)
create table if not exists equipment (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id) on delete cascade,
  kind text not null check (kind in ('lift_machine','lift_gear','other')),
  name text not null,
  ident text,
  owner text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists equipment_site on equipment(site_id);
create table if not exists inspections (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id) on delete cascade,
  equipment_id uuid not null references equipment(id),
  inspected_at date not null,
  next_due date not null,
  inspector text not null,
  cert_path text,
  note text,
  created_by_email text default lower(coalesce(auth.jwt()->>'email','')),
  created_at timestamptz not null default now(),
  constraint next_after check (next_due > inspected_at)
);
create index if not exists inspections_eq on inspections(equipment_id);
drop trigger if exists equipment_no_delete on equipment;
create trigger equipment_no_delete before delete on equipment for each row execute function no_delete();
drop trigger if exists equipment_audit on equipment;
create trigger equipment_audit after insert or update on equipment for each row execute function audit_row();
drop trigger if exists inspections_no_delete on inspections;
create trigger inspections_no_delete before delete on inspections for each row execute function no_delete();
drop trigger if exists inspections_no_update on inspections;
create trigger inspections_no_update before update on inspections for each row execute function no_update();
drop trigger if exists inspections_audit on inspections;
create trigger inspections_audit after insert on inspections for each row execute function audit_row();
alter table equipment enable row level security;
alter table inspections enable row level security;
drop policy if exists p_eq_sel on equipment;
create policy p_eq_sel on equipment for select using (can_see_site(site_id));
drop policy if exists p_eq_ins on equipment;
create policy p_eq_ins on equipment for insert with check (has_site_role(site_id, array['con','so','sm','wm','rep']));
drop policy if exists p_eq_upd on equipment;
create policy p_eq_upd on equipment for update using (has_site_role(site_id, array['con','so','sm','wm','rep'])) with check (has_site_role(site_id, array['con','so','sm','wm','rep']));
drop policy if exists p_in_sel on inspections;
create policy p_in_sel on inspections for select using (can_see_site(site_id));
drop policy if exists p_in_ins on inspections;
create policy p_in_ins on inspections for insert with check (has_site_role(site_id, array['con','so','sm','wm','rep']));
revoke all on equipment, inspections from anon;
grant select, insert, update on equipment to authenticated;
grant select, insert on inspections to authenticated;

-- קבצי עובדים (צילום תעודה, אישור גובה, PDF הדרכה): רק מי שרואה את פנקס העובדים
drop policy if exists safety_files_sel on storage.objects;
create policy safety_files_sel on storage.objects for select to authenticated using (bucket_id = 'files'
  and case when (storage.foldername(name))[2] = 'workers' then can_see_workers(((storage.foldername(name))[1])::uuid)
           else can_see_site(((storage.foldername(name))[1])::uuid) end);
drop policy if exists safety_files_ins on storage.objects;
create policy safety_files_ins on storage.objects for insert to authenticated with check (bucket_id = 'files'
  and case when (storage.foldername(name))[2] = 'workers' then can_register_workers(((storage.foldername(name))[1])::uuid)
           else has_site_role(((storage.foldername(name))[1])::uuid, array['dev','bakar','con','so','sm','wm','rep']) end);

-- יומן הביקורת: שינויים בפנקס העובדים ובהדרכות גלויים רק למי שרואה את הפנקס
drop policy if exists p_a_sel on audit_log;
create policy p_a_sel on audit_log for select using (is_service_admin() or (site_id is not null and can_see_site(site_id)
  and (table_name not in ('workers','trainings') or can_see_workers(site_id))));

-- ===== חבילה 1.6 (supabase/field16.sql) =====
-- חבילה 1.6: נוכחות יומית, אישור עבודה בגובה חובה עם החרגה באישור, ביקורת באתר
-- להריץ פעם אחת ב-SQL Editor. בטוח להריץ שוב.

-- ===== 1. נוכחות יומית של עובדים =====
-- שורה לכל עובד ליום. מסמנים רק להיום (שעון ישראל). השעה ומי סימן נקבעים בשרת
create table if not exists attendance (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id) on delete cascade,
  worker_id uuid not null references workers(id),
  day date not null,
  present boolean not null default true,
  marked_by_email text,
  marked_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (worker_id, day)
);
create index if not exists attendance_site_day on attendance(site_id, day);

create or replace function attendance_stamp() returns trigger language plpgsql set search_path = public as $$
begin
  if new.day <> (now() at time zone 'Asia/Jerusalem')::date then
    raise exception 'attendance_day: אפשר לסמן נוכחות רק להיום';
  end if;
  if not exists (select 1 from workers w where w.id = new.worker_id and w.site_id = new.site_id and w.active) then
    raise exception 'worker_mismatch';
  end if;
  if tg_op = 'UPDATE' then
    if new.worker_id <> old.worker_id or new.site_id <> old.site_id or new.day <> old.day then raise exception 'attendance_locked'; end if;
    new.created_at := old.created_at;
  else
    new.created_at := now();
  end if;
  new.marked_by_email := my_email();
  new.marked_at := now();
  return new;
end $$;
drop trigger if exists attendance_stamp on attendance;
create trigger attendance_stamp before insert or update on attendance for each row execute function attendance_stamp();
revoke execute on function attendance_stamp() from public, anon, authenticated;
drop trigger if exists attendance_no_delete on attendance;
create trigger attendance_no_delete before delete on attendance for each row execute function no_delete();
drop trigger if exists attendance_audit on attendance;
create trigger attendance_audit after insert or update on attendance for each row execute function audit_row();
alter table attendance enable row level security;
drop policy if exists p_att_sel on attendance;
create policy p_att_sel on attendance for select using (can_see_workers(site_id));
drop policy if exists p_att_ins on attendance;
create policy p_att_ins on attendance for insert with check (can_register_workers(site_id));
drop policy if exists p_att_upd on attendance;
create policy p_att_upd on attendance for update using (can_register_workers(site_id)) with check (can_register_workers(site_id));
revoke all on attendance from anon;
grant select, insert, update on attendance to authenticated;

-- ===== 2. החרגה מאישור עבודה בגובה =====
-- כל עובד באתר צריך אישור עבודה בגובה. החרגה רק באישור:
-- באתר שיש בו מנהל אתר: מנהל האתר בלבד. באתר בלי מנהל אתר: הנהלת הקבלן הראשי או מנהל השירות
create or replace function can_exempt_height(s uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select case when exists (select 1 from site_people p where p.site_id = s and p.role = 'sm' and p.active)
    then coalesce(my_site_roles(s) && array['sm'], false)
    else has_site_role(s, array['con']) end
$$;
revoke execute on function can_exempt_height(uuid) from public, anon;
grant execute on function can_exempt_height(uuid) to authenticated;

-- שורה לכל החלטה (החרגה או ביטול החרגה). לא נערכת ולא נמחקת. ההחלטה האחרונה קובעת
create table if not exists worker_exemptions (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id) on delete cascade,
  worker_id uuid not null references workers(id),
  kind text not null default 'height' check (kind in ('height')),
  cancel boolean not null default false,
  reason text not null check (length(trim(reason)) >= 5),
  approver_name text,
  approver_role text,
  approved_by_email text,
  created_at timestamptz not null default now()
);
create index if not exists worker_exemptions_w on worker_exemptions(worker_id);
create or replace function worker_exemption_stamp() returns trigger language plpgsql set search_path = public as $$
begin
  if not exists (select 1 from workers w where w.id = new.worker_id and w.site_id = new.site_id) then raise exception 'worker_mismatch'; end if;
  new.approved_by_email := my_email();
  new.created_at := now();
  new.approver_role := case when exists (select 1 from site_people p where p.site_id = new.site_id and p.role = 'sm' and p.active) then 'sm'
    when is_service_admin() then 'admin' else 'con' end;
  return new;
end $$;
drop trigger if exists worker_exemptions_stamp on worker_exemptions;
create trigger worker_exemptions_stamp before insert on worker_exemptions for each row execute function worker_exemption_stamp();
revoke execute on function worker_exemption_stamp() from public, anon, authenticated;
drop trigger if exists worker_exemptions_no_delete on worker_exemptions;
create trigger worker_exemptions_no_delete before delete on worker_exemptions for each row execute function no_delete();
drop trigger if exists worker_exemptions_no_update on worker_exemptions;
create trigger worker_exemptions_no_update before update on worker_exemptions for each row execute function no_update();
drop trigger if exists worker_exemptions_audit on worker_exemptions;
create trigger worker_exemptions_audit after insert on worker_exemptions for each row execute function audit_row();
alter table worker_exemptions enable row level security;
drop policy if exists p_wx_sel on worker_exemptions;
create policy p_wx_sel on worker_exemptions for select using (can_see_workers(site_id));
drop policy if exists p_wx_ins on worker_exemptions;
create policy p_wx_ins on worker_exemptions for insert with check (can_exempt_height(site_id));
revoke all on worker_exemptions from anon;
grant select, insert on worker_exemptions to authenticated;

-- ===== 3. ביקורת באתר =====
-- רישום של כל ביקורת: מי המבקר, מתי נפתחה, למי נשלחה הודעה, וה-PDF שהופק
create table if not exists site_inspections (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id) on delete cascade,
  inspector_name text not null,
  inspector_role text,
  purpose text,
  started_at timestamptz not null default now(),
  started_by_email text,
  notified jsonb not null default '[]'::jsonb,
  pdf_path text,
  pdf_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists site_inspections_site on site_inspections(site_id);
create or replace function site_inspection_stamp() returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.started_at := now(); new.created_at := now(); new.started_by_email := my_email(); new.pdf_at := null;
  else
    -- אחרי הפתיחה משנים רק את רשימת ההודעות ואת ה-PDF
    if row(new.site_id, new.inspector_name, new.inspector_role, new.purpose, new.started_at, new.started_by_email, new.created_at)
       is distinct from row(old.site_id, old.inspector_name, old.inspector_role, old.purpose, old.started_at, old.started_by_email, old.created_at) then
      raise exception 'inspection_locked';
    end if;
    if new.pdf_path is distinct from old.pdf_path then new.pdf_at := now(); else new.pdf_at := old.pdf_at; end if;
  end if;
  return new;
end $$;
drop trigger if exists site_inspections_stamp on site_inspections;
create trigger site_inspections_stamp before insert or update on site_inspections for each row execute function site_inspection_stamp();
revoke execute on function site_inspection_stamp() from public, anon, authenticated;
drop trigger if exists site_inspections_no_delete on site_inspections;
create trigger site_inspections_no_delete before delete on site_inspections for each row execute function no_delete();
drop trigger if exists site_inspections_audit on site_inspections;
create trigger site_inspections_audit after insert or update on site_inspections for each row execute function audit_row();
alter table site_inspections enable row level security;
drop policy if exists p_si_sel on site_inspections;
create policy p_si_sel on site_inspections for select using (can_see_site(site_id));
drop policy if exists p_si_ins on site_inspections;
create policy p_si_ins on site_inspections for insert with check (has_site_role(site_id, array['dev','bakar','con','so','sm','wm','rep']));
drop policy if exists p_si_upd on site_inspections;
create policy p_si_upd on site_inspections for update using (has_site_role(site_id, array['dev','bakar','con','so','sm','wm','rep']))
  with check (has_site_role(site_id, array['dev','bakar','con','so','sm','wm','rep']));
revoke all on site_inspections from anon;
grant select, insert, update on site_inspections to authenticated;

-- יומן הביקורת: נוכחות והחרגות גלויות רק למי שרואה את פנקס העובדים
drop policy if exists p_a_sel on audit_log;
create policy p_a_sel on audit_log for select using (is_service_admin() or (site_id is not null and can_see_site(site_id)
  and (table_name not in ('workers','trainings','attendance','worker_exemptions') or can_see_workers(site_id))));

-- קבצים: דוח ביקורת עם פרטי עובדים נשמר בתיקיית העובדים. מותר לשמור אותו גם למי שרואה את פנקס העובדים (למשל הנהלת הקבלן)
drop policy if exists safety_files_ins on storage.objects;
create policy safety_files_ins on storage.objects for insert to authenticated with check (bucket_id = 'files'
  and case when (storage.foldername(name))[2] = 'workers' then
             can_register_workers(((storage.foldername(name))[1])::uuid)
             or ((storage.foldername(name))[3] = 'inspections' and can_see_workers(((storage.foldername(name))[1])::uuid))
           else has_site_role(((storage.foldername(name))[1])::uuid, array['dev','bakar','con','so','sm','wm','rep']) end);

-- חבילה 1.7 שלב א: עבודה בלי קליטה, נוסח חתימה בשפת העובד, ליקויי בטיחות עם צילום לפני ואחרי
-- להריץ פעם אחת ב-SQL Editor. בטוח להריץ שוב.

-- ===== 1. נוכחות שסומנה בלי קליטה =====
-- נוכחות שסומנה בטלפון בלי קליטה נשלחת כשחוזרת הקליטה, לפעמים למחרת. מותר לסמן להיום ועד יומיים אחורה
create or replace function attendance_stamp() returns trigger language plpgsql set search_path = public as $$
declare d date := (now() at time zone 'Asia/Jerusalem')::date;
begin
  if new.day > d or new.day < d - 2 then
    raise exception 'attendance_day: אפשר לסמן נוכחות להיום, ועד יומיים אחורה לסימון שנעשה בלי קליטה';
  end if;
  if not exists (select 1 from workers w where w.id = new.worker_id and w.site_id = new.site_id and w.active) then
    raise exception 'worker_mismatch';
  end if;
  if tg_op = 'UPDATE' then
    if new.worker_id <> old.worker_id or new.site_id <> old.site_id or new.day <> old.day then raise exception 'attendance_locked'; end if;
    new.created_at := old.created_at;
  else
    new.created_at := now();
  end if;
  new.marked_by_email := my_email();
  new.marked_at := now();
  return new;
end $$;
revoke execute on function attendance_stamp() from public, anon, authenticated;

-- ===== 2. שפת העובד ונוסח החתימה בשפתו =====
alter table workers add column if not exists language text not null default 'he';
alter table workers drop constraint if exists workers_language_chk;
alter table workers add constraint workers_language_chk check (language in ('he','ar','ru','th','ro','zh','en'));

alter table training_signatures add column if not exists statement_local text;
alter table training_signatures add column if not exists lang text;
-- שעת הטלפון בחתימה (חשוב לחתימה שנעשתה בלי קליטה). שעת השרת נשארת signed_at
alter table training_signatures add column if not exists client_signed_at timestamptz;

create or replace function training_sig_stamp() returns trigger language plpgsql set search_path = public as $$
declare t trainings;
begin
  select * into t from trainings where id = new.training_id;
  if t.id is null or t.site_id <> new.site_id then raise exception 'training_mismatch'; end if;
  if t.closed_at is not null then raise exception 'training_closed: ההדרכה נסגרה ואי אפשר להוסיף חתימות'; end if;
  if not exists (select 1 from workers w where w.id = new.worker_id and w.site_id = new.site_id and w.active) then raise exception 'worker_mismatch'; end if;
  new.signed_at := now(); new.created_at := now(); new.signed_by_email := my_email();
  -- שעת טלפון מתקבלת רק אם היא סבירה: לא בעתיד ולא יותר משלושה ימים אחורה
  if new.client_signed_at is not null and (new.client_signed_at > now() + interval '5 minutes' or new.client_signed_at < now() - interval '3 days') then
    new.client_signed_at := null;
  end if;
  return new;
end $$;
revoke execute on function training_sig_stamp() from public, anon, authenticated;

-- הדרכה שנפתחה בלי קליטה ונסגרת אחרי החתימות: סדר השליחה נשמר, אין צורך בשינוי

-- ===== 3. ליקויי בטיחות =====
create table if not exists defects (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id) on delete cascade,
  title text not null check (length(trim(title)) >= 3),
  location text,
  severity text not null default 'high' check (severity in ('crit','high','normal')),
  source text not null default 'other' check (source in ('checkin','so','bakar','sm','inspector','other')),
  responsible text not null check (length(trim(responsible)) >= 2),
  due_date date not null,
  before_path text not null,
  after_path text,
  fix_note text,
  closed_at timestamptz,
  closed_by_email text,
  event_id uuid references events(id),
  created_by_email text,
  created_at timestamptz not null default now()
);
create index if not exists defects_site on defects(site_id, closed_at);

create or replace function defect_stamp() returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.created_by_email := my_email(); new.created_at := now();
    new.after_path := null; new.fix_note := null; new.closed_at := null; new.closed_by_email := null;
    return new;
  end if;
  if old.closed_at is not null then raise exception 'defect_closed: ליקוי שנסגר לא משתנה'; end if;
  if row(new.site_id, new.title, new.before_path, new.source, new.event_id, new.created_by_email, new.created_at)
     is distinct from row(old.site_id, old.title, old.before_path, old.source, old.event_id, old.created_by_email, old.created_at) then
    raise exception 'defect_locked';
  end if;
  -- סגירה: רק עם צילום אחרי ותיאור. השעה ומי סגר נקבעים בשרת
  if new.after_path is not null or new.closed_at is not null then
    if new.after_path is null or length(trim(coalesce(new.fix_note, ''))) < 3 then raise exception 'defect_needs_after: ליקוי נסגר רק עם צילום אחרי ותיאור התיקון'; end if;
    new.closed_at := now(); new.closed_by_email := my_email();
  end if;
  return new;
end $$;
drop trigger if exists defects_stamp on defects;
create trigger defects_stamp before insert or update on defects for each row execute function defect_stamp();
revoke execute on function defect_stamp() from public, anon, authenticated;
drop trigger if exists defects_no_delete on defects;
create trigger defects_no_delete before delete on defects for each row execute function no_delete();
drop trigger if exists defects_audit on defects;
create trigger defects_audit after insert or update on defects for each row execute function audit_row();
alter table defects enable row level security;
drop policy if exists p_df_sel on defects;
create policy p_df_sel on defects for select using (can_see_site(site_id));
drop policy if exists p_df_ins on defects;
create policy p_df_ins on defects for insert with check (has_site_role(site_id, array['dev','bakar','con','so','sm','wm','rep']));
drop policy if exists p_df_upd on defects;
create policy p_df_upd on defects for update using (has_site_role(site_id, array['con','so','sm','wm','rep']))
  with check (has_site_role(site_id, array['con','so','sm','wm','rep']));
revoke all on defects from anon;
grant select, insert, update on defects to authenticated;

-- חבילה 1.7 שלב ב: דוח ביקור בקר בטלפון, תיעוד תאונה עם הצהרות עדים חתומות
-- להריץ פעם אחת ב-SQL Editor, אחרי field17a.sql. בטוח להריץ שוב.

-- ===== 1. דוח ביקור בקר בטיחות =====
create table if not exists bakar_reports (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id) on delete cascade,
  duty_id uuid references duties(id),
  event_id uuid references events(id),
  visit_at timestamptz not null,
  stage text,
  bakar_name text not null,
  summary text,
  findings jsonb not null default '[]'::jsonb,
  recommendations text,
  pdf_path text,
  pdf_at timestamptz,
  created_by_email text,
  created_at timestamptz not null default now()
);
create index if not exists bakar_reports_site on bakar_reports(site_id);
create or replace function bakar_report_stamp() returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.visit_at > now() + interval '5 minutes' then raise exception 'visit_future: מועד הביקור לא יכול להיות בעתיד'; end if;
    new.created_by_email := my_email(); new.created_at := now(); new.pdf_at := null;
    return new;
  end if;
  -- אחרי השמירה משנים רק את קובץ ה-PDF
  if row(new.site_id, new.duty_id, new.event_id, new.visit_at, new.stage, new.bakar_name, new.summary, new.findings, new.recommendations, new.created_by_email, new.created_at)
     is distinct from row(old.site_id, old.duty_id, old.event_id, old.visit_at, old.stage, old.bakar_name, old.summary, old.findings, old.recommendations, old.created_by_email, old.created_at) then
    raise exception 'report_locked: דוח שנשמר לא משתנה';
  end if;
  if new.pdf_path is distinct from old.pdf_path then new.pdf_at := now(); else new.pdf_at := old.pdf_at; end if;
  return new;
end $$;
drop trigger if exists bakar_reports_stamp on bakar_reports;
create trigger bakar_reports_stamp before insert or update on bakar_reports for each row execute function bakar_report_stamp();
revoke execute on function bakar_report_stamp() from public, anon, authenticated;
drop trigger if exists bakar_reports_no_delete on bakar_reports;
create trigger bakar_reports_no_delete before delete on bakar_reports for each row execute function no_delete();
drop trigger if exists bakar_reports_audit on bakar_reports;
create trigger bakar_reports_audit after insert or update on bakar_reports for each row execute function audit_row();
alter table bakar_reports enable row level security;
drop policy if exists p_br_sel on bakar_reports;
create policy p_br_sel on bakar_reports for select using (can_see_site(site_id));
-- כותב: הבקר, או היזם כשאין בקר (תקנה 1א(ב))
drop policy if exists p_br_ins on bakar_reports;
create policy p_br_ins on bakar_reports for insert with check (has_site_role(site_id, array['bakar','dev']));
drop policy if exists p_br_upd on bakar_reports;
create policy p_br_upd on bakar_reports for update using (has_site_role(site_id, array['bakar','dev'])) with check (has_site_role(site_id, array['bakar','dev']));
revoke all on bakar_reports from anon;
grant select, insert, update on bakar_reports to authenticated;

-- ===== 2. תיעוד תאונה =====
create table if not exists accident_reports (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id) on delete cascade,
  event_id uuid not null references events(id),
  worker_id uuid references workers(id),
  injured_name text not null,
  injured_id text,
  occurred_at timestamptz not null,
  place text not null,
  how text not null,
  injury text,
  evac text,
  first_aid text,
  photos jsonb not null default '[]'::jsonb,
  witnesses jsonb not null default '[]'::jsonb,
  pdf_path text,
  closed_at timestamptz,
  created_by_email text,
  created_at timestamptz not null default now(),
  unique (event_id)
);
create or replace function accident_report_stamp() returns trigger language plpgsql set search_path = public as $$
declare n int;
begin
  if tg_op = 'INSERT' then
    if not exists (select 1 from events e where e.id = new.event_id and e.site_id = new.site_id) then raise exception 'event_mismatch'; end if;
    new.created_by_email := my_email(); new.created_at := now(); new.closed_at := null; new.pdf_path := null; new.witnesses := '[]'::jsonb;
    return new;
  end if;
  if old.closed_at is not null then raise exception 'accident_closed: התיעוד הסתיים ולא משתנה'; end if;
  if row(new.site_id, new.event_id, new.worker_id, new.injured_name, new.injured_id, new.occurred_at, new.place, new.how, new.injury, new.evac, new.first_aid, new.photos, new.created_by_email, new.created_at)
     is distinct from row(old.site_id, old.event_id, old.worker_id, old.injured_name, old.injured_id, old.occurred_at, old.place, old.how, old.injury, old.evac, old.first_aid, old.photos, old.created_by_email, old.created_at) then
    raise exception 'accident_locked: פרטי התאונה לא משתנים אחרי השמירה';
  end if;
  -- הצהרות עדים: רק מוסיפים. הצהרה שנחתמה לא משתנה ולא נמחקת
  n := jsonb_array_length(old.witnesses);
  if jsonb_array_length(new.witnesses) < n or (n > 0 and (select jsonb_agg(e order by i) from jsonb_array_elements(new.witnesses) with ordinality as t(e, i) where i <= n) <> old.witnesses) then
    raise exception 'witness_locked: הצהרה שנחתמה לא משתנה';
  end if;
  if new.closed_at is not null then new.closed_at := now(); end if;
  return new;
end $$;
drop trigger if exists accident_reports_stamp on accident_reports;
create trigger accident_reports_stamp before insert or update on accident_reports for each row execute function accident_report_stamp();
revoke execute on function accident_report_stamp() from public, anon, authenticated;
drop trigger if exists accident_reports_no_delete on accident_reports;
create trigger accident_reports_no_delete before delete on accident_reports for each row execute function no_delete();
drop trigger if exists accident_reports_audit on accident_reports;
create trigger accident_reports_audit after insert or update on accident_reports for each row execute function audit_row();
alter table accident_reports enable row level security;
-- גלוי לצד הקבלן ולבקר (כמו פנקס העובדים) וגם ליזם
drop policy if exists p_ar_sel on accident_reports;
create policy p_ar_sel on accident_reports for select using (can_see_workers(site_id) or has_site_role(site_id, array['dev']));
drop policy if exists p_ar_ins on accident_reports;
create policy p_ar_ins on accident_reports for insert with check (has_site_role(site_id, array['con','so','sm','wm','rep']));
drop policy if exists p_ar_upd on accident_reports;
create policy p_ar_upd on accident_reports for update using (has_site_role(site_id, array['con','so','sm','wm','rep'])) with check (has_site_role(site_id, array['con','so','sm','wm','rep']));
revoke all on accident_reports from anon;
grant select, insert, update on accident_reports to authenticated;

-- יומן הביקורת: תיעוד תאונה גלוי רק למי שרואה אותו
drop policy if exists p_a_sel on audit_log;
create policy p_a_sel on audit_log for select using (is_service_admin() or (site_id is not null and can_see_site(site_id)
  and (table_name not in ('workers','trainings','attendance','worker_exemptions','accident_reports') or can_see_workers(site_id)
       or (table_name = 'accident_reports' and has_site_role(site_id, array['dev'])))));

-- קבצים: צילומי התאונה והצהרות העדים גלויים רק למי שרואה את תיעוד התאונה
drop policy if exists safety_files_sel on storage.objects;
create policy safety_files_sel on storage.objects for select to authenticated using (bucket_id = 'files'
  and case when (storage.foldername(name))[2] = 'workers' then can_see_workers(((storage.foldername(name))[1])::uuid)
           when (storage.foldername(name))[2] = 'reports' and (storage.foldername(name))[3] = 'accident' then
             can_see_workers(((storage.foldername(name))[1])::uuid) or has_site_role(((storage.foldername(name))[1])::uuid, array['dev'])
           else can_see_site(((storage.foldername(name))[1])::uuid) end);

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
