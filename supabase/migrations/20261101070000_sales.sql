-- Vendas registradas pelo usuário. Valores em centavos (BRL).
-- Lucro = valor - custo. Margem = lucro / valor.
create table if not exists public.sales (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  lead_id text,
  client_name text not null check (length(trim(client_name)) between 1 and 160),
  project_name text not null check (length(trim(project_name)) between 1 and 200),
  project_type text check (project_type is null or length(project_type) <= 80),
  sale_date date not null default current_date,
  delivery_due date,
  amount_cents integer not null check (amount_cents >= 0),
  cost_cents integer not null default 0 check (cost_cents >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists sales_user_date_idx on public.sales (user_id, sale_date desc);

alter table public.sales enable row level security;

drop policy if exists sales_select_own on public.sales;
create policy sales_select_own on public.sales for select
  using ((select auth.uid()) is not null and (select auth.uid()) = user_id);

drop policy if exists sales_insert_own on public.sales;
create policy sales_insert_own on public.sales for insert
  with check ((select auth.uid()) is not null and (select auth.uid()) = user_id);

drop policy if exists sales_update_own on public.sales;
create policy sales_update_own on public.sales for update
  using ((select auth.uid()) is not null and (select auth.uid()) = user_id)
  with check ((select auth.uid()) is not null and (select auth.uid()) = user_id);

drop policy if exists sales_delete_own on public.sales;
create policy sales_delete_own on public.sales for delete
  using ((select auth.uid()) is not null and (select auth.uid()) = user_id);

revoke all on table public.sales from anon;
grant select, insert, update, delete on table public.sales to authenticated;
grant all on table public.sales to service_role;
