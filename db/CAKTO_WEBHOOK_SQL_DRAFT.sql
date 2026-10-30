-- Infinity Prospect — Cakto webhook SQL draft
-- REVIEW ONLY: this file has NOT been executed against Supabase.
-- Create a formal migration with `supabase migration new cakto_webhook` before applying.

-- Fail closed before making changes if the existing application schema differs.
do $$
declare v_missing text;
begin
  if to_regclass('public.plans') is null or to_regclass('public.subscriptions') is null then
    raise exception 'PRECONDITION: public.plans or public.subscriptions is missing';
  end if;
  select string_agg(r.t || '.' || r.c, ', ')
    into v_missing
    from (values
      ('plans','id'),('plans','active'),('plans','price_cents'),
      ('subscriptions','user_id'),('subscriptions','plan_id'),('subscriptions','status'),
      ('subscriptions','searches_used'),('subscriptions','starts_at'),('subscriptions','expires_at'),('subscriptions','updated_at')
    ) as r(t,c)
   where not exists (
     select 1 from information_schema.columns c
      where c.table_schema = 'public' and c.table_name = r.t and c.column_name = r.c
   );
  if v_missing is not null then
    raise exception 'PRECONDITION: required columns are missing: %', v_missing;
  end if;
end $$;

alter table public.subscriptions
  add column if not exists payment_provider text,
  add column if not exists external_purchase_id text,
  add column if not exists external_subscription_id text;

create table if not exists public.cakto_webhook_events (
  purchase_id text not null,
  event_type text not null,
  result text not null default 'received',
  user_id uuid references auth.users(id) on delete set null,
  plan_id text,
  amount_cents integer,
  currency text,
  product_id text,
  offer_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  processed_at timestamptz,
  primary key (purchase_id, event_type),
  constraint cakto_webhook_purchase_id_len check (length(purchase_id) between 1 and 128),
  constraint cakto_webhook_event_type check (event_type in (
    'purchase_approved','subscription_renewed','refund','chargeback','subscription_canceled'
  ))
);

create index if not exists cakto_webhook_events_result_idx
  on public.cakto_webhook_events (result, updated_at desc);
create unique index if not exists subscriptions_cakto_purchase_unique_idx
  on public.subscriptions (payment_provider, external_purchase_id)
  where payment_provider = 'cakto' and external_purchase_id is not null;

alter table public.cakto_webhook_events enable row level security;
revoke all on table public.cakto_webhook_events from public, anon, authenticated;
grant all on table public.cakto_webhook_events to service_role;

create or replace function public.process_cakto_webhook(
  p_purchase_id text,
  p_event_type text,
  p_email text,
  p_plan_id text,
  p_amount_cents integer,
  p_catalog_price_cents integer,
  p_currency text,
  p_product_id text,
  p_offer_id text,
  p_subscription_id text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth, pg_temp
as $$
declare
  v_user_id uuid;
  v_plan_id text;
  v_plan_price integer;
  v_plan_active boolean;
  v_result text;
  v_event public.cakto_webhook_events%rowtype;
  v_rows integer;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED';
  end if;
  if p_purchase_id is null or length(p_purchase_id) not between 1 and 128
     or p_purchase_id !~ '^[A-Za-z0-9_-]+$'
     or p_event_type is null
     or p_event_type not in ('purchase_approved','subscription_renewed','refund','chargeback','subscription_canceled') then
    raise exception 'INVALID_INPUT';
  end if;

  insert into public.cakto_webhook_events (
    purchase_id, event_type, result, plan_id, amount_cents, currency, product_id, offer_id
  ) values (
    p_purchase_id, p_event_type, 'received', p_plan_id, p_amount_cents,
    upper(nullif(p_currency,'')), p_product_id, p_offer_id
  ) on conflict (purchase_id, event_type) do nothing;

  -- Serialize all event types for one external purchase (approval vs refund/chargeback).
  -- Taken BEFORE reading the event row so concurrent deliveries see each other's committed results.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('cakto:' || p_purchase_id, 3));

  select * into v_event
    from public.cakto_webhook_events
   where purchase_id = p_purchase_id and event_type = p_event_type
   for update;

  if v_event.result in ('approved','already_processed','revoked','ignored','no_matching_subscription') then
    return jsonb_build_object('result', v_event.result);
  end if;

  if p_event_type in ('purchase_approved','subscription_renewed') then
    -- Two Cakto events may refer to the same paid order. Only one activates it.
    if exists (
      select 1 from public.cakto_webhook_events e
       where e.purchase_id = p_purchase_id
         and e.event_type in ('purchase_approved','subscription_renewed')
         and e.event_type <> p_event_type
         and e.result = 'approved'
    ) then
      update public.cakto_webhook_events
         set result = 'already_processed', updated_at = now(), processed_at = now()
       where purchase_id = p_purchase_id and event_type = p_event_type;
      return jsonb_build_object('result', 'already_processed');
    end if;

    if upper(coalesce(p_currency,'')) <> 'BRL' then
      update public.cakto_webhook_events set result='currency_mismatch', updated_at=now()
       where purchase_id=p_purchase_id and event_type=p_event_type;
      return jsonb_build_object('result','currency_mismatch');
    end if;
    if coalesce(p_amount_cents, 0) <= 0 then
      update public.cakto_webhook_events set result='amount_invalid', updated_at=now()
       where purchase_id=p_purchase_id and event_type=p_event_type;
      return jsonb_build_object('result','amount_invalid');
    end if;
    if nullif(lower(trim(coalesce(p_email,''))), '') is null then
      update public.cakto_webhook_events set result='user_not_found', updated_at=now()
       where purchase_id=p_purchase_id and event_type=p_event_type;
      return jsonb_build_object('result','user_not_found');
    end if;

    select u.id into v_user_id
      from auth.users u
     where lower(u.email) = lower(trim(p_email))
     limit 1;
    if v_user_id is null then
      update public.cakto_webhook_events set result='user_not_found', updated_at=now()
       where purchase_id=p_purchase_id and event_type=p_event_type;
      return jsonb_build_object('result','user_not_found');
    end if;

    if nullif(trim(coalesce(p_plan_id,'')), '') is null then
      update public.cakto_webhook_events set result='plan_not_found', updated_at=now()
       where purchase_id=p_purchase_id and event_type=p_event_type;
      return jsonb_build_object('result','plan_not_found');
    end if;
    select p.id, p.active, p.price_cents into v_plan_id, v_plan_active, v_plan_price
      from public.plans p where p.id::text = p_plan_id::text;
    if v_plan_id is null or v_plan_active is not true or coalesce(v_plan_price,0) <= 0 then
      update public.cakto_webhook_events set result='plan_not_found', updated_at=now()
       where purchase_id=p_purchase_id and event_type=p_event_type;
      return jsonb_build_object('result','plan_not_found');
    end if;
    -- Validate the listed offer/catalog price, not the discounted amount actually charged.
    if p_catalog_price_cents is null or p_catalog_price_cents <> v_plan_price then
      update public.cakto_webhook_events set result='catalog_price_mismatch', updated_at=now()
       where purchase_id=p_purchase_id and event_type=p_event_type;
      return jsonb_build_object('result','catalog_price_mismatch');
    end if;

    -- A refund/chargeback may arrive before the approval event. Never reactivate that purchase.
    if exists (
      select 1 from public.cakto_webhook_events e
       where e.purchase_id = p_purchase_id
         and e.event_type in ('refund','chargeback')
         and e.result in ('revoked','no_matching_subscription','received','review')
    ) then
      update public.cakto_webhook_events set result='revoked', updated_at=now(), processed_at=now()
       where purchase_id=p_purchase_id and event_type=p_event_type;
      return jsonb_build_object('result','revoked');
    end if;

    -- Serialize with the application's existing payment-order functions.
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user_id::text, 1));
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user_id::text, 2));

    -- Re-check after taking the user lock so two different activation events for the same purchase
    -- cannot both insert a subscription.
    if exists (
      select 1 from public.cakto_webhook_events e
       where e.purchase_id = p_purchase_id
         and e.event_type in ('purchase_approved','subscription_renewed')
         and e.event_type <> p_event_type
         and e.result = 'approved'
    ) then
      update public.cakto_webhook_events
         set result='already_processed', updated_at=now(), processed_at=now()
       where purchase_id=p_purchase_id and event_type=p_event_type;
      return jsonb_build_object('result','already_processed');
    end if;

    update public.subscriptions
       set status='expired', updated_at=now()
     where user_id=v_user_id and status='active';

    insert into public.subscriptions (
      user_id, plan_id, status, searches_used, starts_at, expires_at,
      payment_provider, external_purchase_id, external_subscription_id
    ) values (
      v_user_id, v_plan_id, 'active', 0, now(), now() + interval '1 month',
      'cakto', p_purchase_id, nullif(p_subscription_id,'')
    );

    update public.cakto_webhook_events
       set result='approved', user_id=v_user_id, plan_id=v_plan_id,
           amount_cents=p_amount_cents, currency=upper(p_currency),
           product_id=p_product_id, offer_id=p_offer_id,
           updated_at=now(), processed_at=now()
     where purchase_id=p_purchase_id and event_type=p_event_type;
    return jsonb_build_object('result','approved');
  end if;

  if p_event_type in ('refund','chargeback') then
    update public.subscriptions
       set status='expired', updated_at=now()
     where payment_provider='cakto'
       and external_purchase_id=p_purchase_id
       and status='active';
    get diagnostics v_rows = row_count;
    v_result := case when v_rows > 0 then 'revoked' else 'no_matching_subscription' end;
    update public.cakto_webhook_events
       set result=v_result, updated_at=now(), processed_at=now(),
           product_id=p_product_id, offer_id=p_offer_id
     where purchase_id=p_purchase_id and event_type=p_event_type;
    return jsonb_build_object('result',v_result);
  end if;

  if p_event_type = 'subscription_canceled' then
    if nullif(trim(coalesce(p_subscription_id,'')), '') is null then
      update public.cakto_webhook_events set result='no_matching_subscription', updated_at=now(), processed_at=now()
       where purchase_id=p_purchase_id and event_type=p_event_type;
      return jsonb_build_object('result','no_matching_subscription');
    end if;
    update public.subscriptions
       set status='expired', updated_at=now()
     where payment_provider='cakto'
       and external_subscription_id=p_subscription_id
       and status='active';
    get diagnostics v_rows = row_count;
    v_result := case when v_rows > 0 then 'revoked' else 'no_matching_subscription' end;
    update public.cakto_webhook_events
       set result=v_result, updated_at=now(), processed_at=now()
     where purchase_id=p_purchase_id and event_type=p_event_type;
    return jsonb_build_object('result',v_result);
  end if;

  return jsonb_build_object('result','ignored');
end;
$$;

revoke all on function public.process_cakto_webhook(text,text,text,text,integer,integer,text,text,text,text)
  from public, anon, authenticated;
grant execute on function public.process_cakto_webhook(text,text,text,text,integer,integer,text,text,text,text)
  to service_role;
