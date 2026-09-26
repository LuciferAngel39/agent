-- 已在 Supabase 项目 jwmzzrlpyrmqpkaptmlp 执行过。保存在这里作为记录，重建数据库时可以再跑一次。

-- 谁可以使用后台
create table public.admins (
  email text primary key,
  created_at timestamptz not null default now()
);
alter table public.admins enable row level security;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.admins a
    where lower(a.email) = lower(coalesce((select auth.jwt() ->> 'email'), ''))
  );
$$;
revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

create policy "admins can see admin list" on public.admins
  for select to authenticated using ((select public.is_admin()));

-- 代理
create table public.agents (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  phone text not null default '',
  level text not null default 'l1' check (level in ('master','l1','l2')),
  parent_id uuid references public.agents(id) on delete set null,
  region text not null default '',
  rate numeric(5,2) not null default 10 check (rate >= 0 and rate <= 100),
  status text not null default 'on' check (status in ('on','off')),
  joined date default current_date,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (parent_id is null or parent_id <> id)
);
create index agents_parent_id_idx on public.agents(parent_id);

-- 顾客
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  phone text not null default '',
  contact text not null default '',
  agent_id uuid references public.agents(id) on delete set null,
  status text not null default 'lead' check (status in ('lead','active','dormant','lost')),
  spend numeric(12,2) not null default 0 check (spend >= 0),
  last_contact date,
  joined date default current_date,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index customers_agent_id_idx on public.customers(agent_id);

create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end; $$;
create trigger agents_touch before update on public.agents for each row execute function public.touch_updated_at();
create trigger customers_touch before update on public.customers for each row execute function public.touch_updated_at();

-- RLS：只有 admins 表里的邮箱能读写
alter table public.agents enable row level security;
alter table public.customers enable row level security;

create policy "admins select agents" on public.agents for select to authenticated using ((select public.is_admin()));
create policy "admins insert agents" on public.agents for insert to authenticated with check ((select public.is_admin()));
create policy "admins update agents" on public.agents for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "admins delete agents" on public.agents for delete to authenticated using ((select public.is_admin()));

create policy "admins select customers" on public.customers for select to authenticated using ((select public.is_admin()));
create policy "admins insert customers" on public.customers for insert to authenticated with check ((select public.is_admin()));
create policy "admins update customers" on public.customers for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "admins delete customers" on public.customers for delete to authenticated using ((select public.is_admin()));

alter publication supabase_realtime add table public.agents, public.customers;

insert into public.admins(email) values ('dcinvestment126@gmail.com');
