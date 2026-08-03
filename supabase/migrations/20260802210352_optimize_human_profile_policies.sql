drop policy "operators manage human profiles" on public.operations_profiles;

create policy "operators create human profiles"
on public.operations_profiles for insert to authenticated
with check (
  exists (
    select 1 from public.operations_members member
    where member.user_id = (select auth.uid())
      and member.active
      and member.role in ('owner', 'operator')
  )
);

create policy "operators update human profiles"
on public.operations_profiles for update to authenticated
using (
  exists (
    select 1 from public.operations_members member
    where member.user_id = (select auth.uid())
      and member.active
      and member.role in ('owner', 'operator')
  )
)
with check (
  exists (
    select 1 from public.operations_members member
    where member.user_id = (select auth.uid())
      and member.active
      and member.role in ('owner', 'operator')
  )
);

create policy "operators delete human profiles"
on public.operations_profiles for delete to authenticated
using (
  exists (
    select 1 from public.operations_members member
    where member.user_id = (select auth.uid())
      and member.active
      and member.role in ('owner', 'operator')
  )
);
