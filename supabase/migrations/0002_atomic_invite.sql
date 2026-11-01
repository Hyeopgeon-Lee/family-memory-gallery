-- Atomic invitation acceptance: Worker service role only.
-- This function is intentionally callable only from trusted server code.
create function public.accept_family_invite(
  p_hash text, p_actor uuid
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  invite public.invitations%rowtype;
  verified_email text;
begin
  select u.email into verified_email
    from auth.users u
   where u.id = p_actor and u.email_confirmed_at is not null;
  if verified_email is null then
    raise exception 'email not verified';
  end if;

  select i.* into invite
    from public.invitations i
   where i.token_hash = p_hash
     and i.used_at is null
     and i.expires_at > now()
   for update;

  if not found then
    raise exception 'invitation expired or used';
  end if;

  if lower(invite.email) <> lower(verified_email) then
    raise exception 'invitation email mismatch';
  end if;

  if exists (
    select 1 from public.family_members fm
    where fm.family_id = invite.family_id
      and fm.user_id = p_actor
      and fm.status = 'active'
  ) then
    raise exception 'already a family member';
  end if;

  insert into public.family_members(family_id,user_id,role,status)
  values(invite.family_id,p_actor,invite.role,'active')
  on conflict (family_id,user_id) do update
     set role = excluded.role,
         status = 'active'
   where public.family_members.role <> 'owner';

  if not found then
    raise exception 'cannot change family owner';
  end if;

  update public.invitations
     set used_at = now()
   where id = invite.id;

  return invite.family_id;
end;
$$;
revoke all on function public.accept_family_invite(text,uuid) from public,anon,authenticated;
grant execute on function public.accept_family_invite(text,uuid) to service_role;
