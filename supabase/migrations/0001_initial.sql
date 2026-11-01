-- Dedicated Supabase project only. Apply through Supabase SQL Editor.
create extension if not exists pgcrypto;
create schema if not exists private;
create table public.families (
  id uuid primary key default gen_random_uuid(),
  name text not null check(length(name) between 1 and 100),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);
create table public.family_members (
  family_id uuid not null references public.families(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  role text not null check(role in ('owner','admin','contributor','viewer')),
  status text not null default 'active' check(status in ('active','suspended')),
  joined_at timestamptz not null default now(),
  primary key(family_id,user_id)
);
create index family_members_user_idx on public.family_members(user_id);
create unique index one_owner_per_family on public.family_members(family_id) where role='owner';
create table public.albums (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  title text not null check(length(title) between 1 and 150),
  description text not null default '',
  event_date date,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique(id,family_id)
);
create index albums_family_idx on public.albums(family_id,event_date desc);
create table public.media (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id),
  album_id uuid not null,
  uploaded_by uuid not null references auth.users(id),
  media_type text not null check(media_type in ('image','video')),
  mime_type text not null,
  original_filename text not null,
  storage_key text not null unique,
  thumbnail_key text,
  size_bytes bigint not null check(size_bytes>0),
  captured_at timestamptz,
  status text not null default 'pending' check(status in ('pending','uploading','ready','failed','deleted')),
  upload_id text,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  foreign key(album_id,family_id) references public.albums(id,family_id),
  unique(id,family_id)
);
create index media_family_idx on public.media(family_id,captured_at desc,created_at desc);
create index media_album_idx on public.media(album_id,status);
create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  email text not null,
  role text not null check(role in ('admin','contributor','viewer')),
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);
create table public.comments (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null,
  media_id uuid not null,
  author_id uuid not null references auth.users(id),
  body text not null check(length(body) between 1 and 2000),
  created_at timestamptz not null default now(),
  foreign key(media_id,family_id) references public.media(id,family_id)
);
create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id),
  actor_id uuid references auth.users(id),
  action text not null,
  resource_id uuid,
  created_at timestamptz not null default now()
);

-- RLS: clients read authorized records only; all writes via Worker.
create function private.member_role(target_family uuid)
returns text language sql stable security definer set search_path = ''
as $fn$
  select role from public.family_members
  where family_id=target_family and user_id=(select auth.uid())
    and status='active' limit 1
$fn$;
revoke all on function private.member_role(uuid) from public;
grant usage on schema private to authenticated;
grant execute on function private.member_role(uuid) to authenticated;
alter table public.families enable row level security;
alter table public.family_members enable row level security;
alter table public.albums enable row level security;
alter table public.media enable row level security;
alter table public.invitations enable row level security;
alter table public.comments enable row level security;
alter table public.audit_logs enable row level security;
revoke all on public.families,public.family_members,public.albums,public.media,public.invitations,public.comments,public.audit_logs from anon,authenticated;
grant select on public.families,public.family_members,public.albums,public.media,public.comments to authenticated;
create policy family_select on public.families for select to authenticated
  using(private.member_role(id) is not null);
create policy membership_select on public.family_members for select to authenticated
  using(private.member_role(family_id) is not null);
create policy albums_select on public.albums for select to authenticated
  using(private.member_role(family_id) is not null);
create policy media_select on public.media for select to authenticated
  using(private.member_role(family_id) is not null and
  (status='ready' or (uploaded_by=(select auth.uid()) and status in ('pending','uploading','failed'))));
create policy comments_select on public.comments for select to authenticated
  using(private.member_role(family_id) is not null);

-- Atomic quota + permission check when reserving an upload.
create function public.reserve_media_upload(
 p_family uuid,p_album uuid,p_actor uuid,p_kind text,p_mime text,
 p_filename text,p_bytes bigint,p_captured timestamptz,p_max bigint
) returns public.media language plpgsql security definer set search_path = ''
as $fn$
declare rec public.media; total bigint;
begin
 if p_bytes<=0 or p_bytes>524288000 or p_max<=0 then
   raise exception 'invalid upload size';
 end if;
 if not exists(select 1 from public.family_members
   where family_id=p_family and user_id=p_actor and status='active'
   and role in ('owner','admin','contributor')) then
   raise exception 'permission denied';
 end if;
 if not exists(select 1 from public.albums
   where id=p_album and family_id=p_family) then
   raise exception 'invalid album';
 end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_family::text,0));
 select coalesce(sum(size_bytes),0) into total
   from public.media where family_id=p_family and status in ('pending','uploading','ready','deleted');
 if total+p_bytes>p_max then raise exception 'storage quota exceeded'; end if;
 rec.id:=pg_catalog.gen_random_uuid();
 rec.family_id:=p_family;
 rec.album_id:=p_album;
 rec.uploaded_by:=p_actor;
 rec.media_type:=p_kind;
 rec.mime_type:=p_mime;
 rec.original_filename:=left(p_filename,250);
 rec.size_bytes:=p_bytes;
 rec.captured_at:=p_captured;
 rec.storage_key:='families/'||p_family::text||'/originals/'||rec.id::text;
 insert into public.media(id,family_id,album_id,uploaded_by,media_type,mime_type,
   original_filename,size_bytes,captured_at,storage_key)
 values(rec.id,rec.family_id,rec.album_id,rec.uploaded_by,rec.media_type,
   rec.mime_type,rec.original_filename,rec.size_bytes,rec.captured_at,rec.storage_key)
 returning * into rec;
 return rec;
end;
$fn$;
revoke all on function public.reserve_media_upload(uuid,uuid,uuid,text,text,text,bigint,timestamptz,bigint) from public,anon,authenticated;
grant execute on function public.reserve_media_upload(uuid,uuid,uuid,text,text,text,bigint,timestamptz,bigint) to service_role;
