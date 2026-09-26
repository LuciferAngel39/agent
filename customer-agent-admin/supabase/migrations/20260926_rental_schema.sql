-- 已在 Supabase 项目 jwmzzrlpyrmqpkaptmlp 执行。房间出租：房间、合伙人、租约、收费、开销。

alter table public.customers add column if not exists id_no text not null default '';

create table public.partners (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  phone text not null default '',
  bank_info text not null default '',
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (length(trim(code)) > 0),
  location text not null default '',
  room_type text not null default '',
  status text not null default 'ok' check (status in ('ok','maintenance')),
  monthly_rent numeric(12,2) not null default 0 check (monthly_rent >= 0),
  daily_rent numeric(12,2) not null default 0 check (daily_rent >= 0),
  partner_id uuid references public.partners(id) on delete set null,
  partner_share numeric(5,2) not null default 0 check (partner_share >= 0 and partner_share <= 100),
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index rooms_partner_id_idx on public.rooms(partner_id);

create table public.leases (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete restrict,
  tenant_id uuid references public.customers(id) on delete set null,
  rent_type text not null default 'monthly' check (rent_type in ('monthly','daily')),
  rent numeric(12,2) not null default 0 check (rent >= 0),
  deposit numeric(12,2) not null default 0 check (deposit >= 0),
  start_date date not null default current_date,
  end_date date,
  status text not null default 'active' check (status in ('active','ended','cancelled')),
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date is null or end_date >= start_date)
);
create index leases_room_id_idx on public.leases(room_id);
create index leases_tenant_id_idx on public.leases(tenant_id);
create index leases_status_idx on public.leases(status);

create table public.charges (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete restrict,
  lease_id uuid references public.leases(id) on delete set null,
  tenant_id uuid references public.customers(id) on delete set null,
  category text not null default 'rent' check (category in ('rent','deposit','deposit_refund','electricity','water','internet','cleaning','late_fee','other')),
  amount numeric(12,2) not null check (amount >= 0),
  period text not null check (period ~ '^\d{4}-\d{2}$'),
  due_date date,
  paid boolean not null default false,
  paid_date date,
  method text not null default '',
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index charges_room_id_idx on public.charges(room_id);
create index charges_lease_id_idx on public.charges(lease_id);
create index charges_tenant_id_idx on public.charges(tenant_id);
create index charges_period_idx on public.charges(period);
create index charges_unpaid_idx on public.charges(paid) where paid = false;

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  room_id uuid references public.rooms(id) on delete restrict,
  category text not null default 'other' check (category in ('repair','utilities','internet','cleaning','furniture','management','other')),
  amount numeric(12,2) not null check (amount >= 0),
  period text not null check (period ~ '^\d{4}-\d{2}$'),
  expense_date date default current_date,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index expenses_room_id_idx on public.expenses(room_id);
create index expenses_period_idx on public.expenses(period);

create trigger partners_touch before update on public.partners for each row execute function public.touch_updated_at();
create trigger rooms_touch before update on public.rooms for each row execute function public.touch_updated_at();
create trigger leases_touch before update on public.leases for each row execute function public.touch_updated_at();
create trigger charges_touch before update on public.charges for each row execute function public.touch_updated_at();
create trigger expenses_touch before update on public.expenses for each row execute function public.touch_updated_at();

do $$
declare t text;
begin
  foreach t in array array['partners','rooms','leases','charges','expenses'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "admins select %1$s" on public.%1$I for select to authenticated using ((select public.is_admin()))', t);
    execute format('create policy "admins insert %1$s" on public.%1$I for insert to authenticated with check ((select public.is_admin()))', t);
    execute format('create policy "admins update %1$s" on public.%1$I for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()))', t);
    execute format('create policy "admins delete %1$s" on public.%1$I for delete to authenticated using ((select public.is_admin()))', t);
  end loop;
end $$;

alter publication supabase_realtime add table public.partners, public.rooms, public.leases, public.charges, public.expenses;
