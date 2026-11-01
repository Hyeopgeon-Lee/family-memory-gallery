-- Secondary indexes for common foreign-key lookups (server and family RLS).
create index if not exists families_created_by_idx on public.families(created_by);
create index if not exists albums_created_by_idx on public.albums(created_by);
create index if not exists media_uploaded_by_idx on public.media(uploaded_by);
create index if not exists media_album_family_idx on public.media(album_id, family_id);
create index if not exists invitations_family_idx on public.invitations(family_id);
create index if not exists invitations_created_by_idx on public.invitations(created_by);
create index if not exists comments_media_family_idx on public.comments(media_id, family_id);
create index if not exists comments_author_idx on public.comments(author_id);
create index if not exists audit_logs_family_idx on public.audit_logs(family_id);
create index if not exists audit_logs_actor_idx on public.audit_logs(actor_id);
