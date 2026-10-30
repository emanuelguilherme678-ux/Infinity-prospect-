import { createHmac, timingSafeEqual } from 'node:crypto';

export const config = { api: { bodyParser: false } };

const MAX_BODY_BYTES = 256 * 1024;
const MAX_ITEMS = 20;
const SIGNATURE_TOLERANCE_SECONDS = 300;
const SUPPORTED_EVENTS = new Set([
  'purchase_approved',
  'subscription_renewed',
  'refund',
  'chargeback',
  'subscription_canceled',
]);
const ACTIVATION_EVENTS = new Set(['purchase_approved', 'subscription_renewed']);

function response(res, status, body) {
  return res.status(status).json(body);
}

function safeEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const a = Buffer.from(left, 'utf8');
  const b = Buffer.from(right, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

export function signatureMatches(rawBody, timestamp, signature, secret, nowMs = Date.now()) {
  if (!rawBody || !timestamp || !signature || !secret) return false;
  if (!/^\d{10,13}$/.test(String(timestamp))) return false;
  const timestampNumber = Number(timestamp);
  if (!Number.isFinite(timestampNumber)) return false;
  const timestampSeconds = timestampNumber > 1e12 ? timestampNumber / 1000 : timestampNumber;
  if (Math.abs(nowMs / 1000 - timestampSeconds) > SIGNATURE_TOLERANCE_SECONDS) return false;

  // During key rotation, Cakto may send comma-separated signatures. Accept only v1.
  const v1 = String(signature).split(',').map((part) => part.trim()).find((part) => part.startsWith('v1='));
  if (!v1) return false;
  const digest = createHmac('sha256', secret)
    .update(`${timestamp}.`, 'utf8')
    .update(rawBody)
    .digest('hex');
  return safeEqual(v1, `v1=${digest}`);
}

export function verifyCaktoRequest({ rawBody, headers = {}, payload, secret, nowMs = Date.now() }) {
  if (!secret || typeof secret !== 'string') return { ok: false, reason: 'missing_server_secret' };
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { ok: false, reason: 'invalid_payload' };
  if (!safeEqual(String(payload.secret || ''), secret)) return { ok: false, reason: 'body_secret_mismatch' };

  const timestamp = headers['x-cakto-timestamp'] ?? headers['X-Cakto-Timestamp'];
  const signature = headers['x-cakto-signature'] ?? headers['X-Cakto-Signature'];
  if (timestamp || signature) {
    if (!signatureMatches(rawBody, String(timestamp || ''), String(signature || ''), secret, nowMs)) {
      return { ok: false, reason: 'invalid_signature' };
    }
  }
  return { ok: true };
}

export function normalizeItems(data) {
  if (Array.isArray(data)) return data.filter((item) => item && typeof item === 'object' && !Array.isArray(item));
  if (data && typeof data === 'object') return [data];
  return [];
}

function text(value, max = 200) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

export function moneyToCents(value) {
  if (value === null || value === undefined || value === '') return null;
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0 || amount > 10000000) return null;
  return Math.round((amount + Number.EPSILON) * 100);
}

function planConfig(env) {
  return [
    {
      planId: text(env.CAKTO_BASIC_PLAN_ID || 'basico', 60),
      productId: text(env.CAKTO_BASIC_PRODUCT_ID, 120),
      offerId: text(env.CAKTO_BASIC_OFFER_ID, 120),
    },
    {
      planId: text(env.CAKTO_PRO_PLAN_ID || 'pro', 60),
      productId: text(env.CAKTO_PRO_PRODUCT_ID, 120),
      offerId: text(env.CAKTO_PRO_OFFER_ID, 120),
    },
    {
      planId: text(env.CAKTO_PREMIUM_PLAN_ID || 'premium', 60),
      productId: text(env.CAKTO_PREMIUM_PRODUCT_ID, 120),
      offerId: text(env.CAKTO_PREMIUM_OFFER_ID, 120),
    },
  ].filter((entry) => entry.productId || entry.offerId);
}

export function mapPurchaseToPlan(item, env = process.env) {
  const productId = text(item?.product?.id, 120);
  const offerId = text(item?.offer?.id, 120);
  const configs = planConfig(env);
  const matches = configs.filter((entry) =>
    (entry.productId && entry.productId === productId) ||
    (entry.offerId && entry.offerId === offerId)
  );
  const planIds = [...new Set(matches.map((entry) => entry.planId))];
  if (planIds.length > 1) return { ok: false, reason: 'ambiguous_product_mapping' };
  if (planIds.length === 1) return { ok: true, planId: planIds[0] };
  return { ok: false, reason: 'product_not_configured' };
}

async function readRawBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) {
      const error = new Error('body_too_large');
      error.status = 413;
      throw error;
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

async function callSupabaseRpc({ env, fetchImpl, args, deadline }) {
  const baseUrl = String(env.SUPABASE_URL || '').replace(/\/$/, '');
  const serviceKey = String(env.SUPABASE_SERVICE_ROLE_KEY || '');
  if (!baseUrl || !serviceKey) {
    const error = new Error('supabase_not_configured');
    error.status = 503;
    throw error;
  }

  const remaining = deadline - Date.now();
  if (remaining <= 250) {
    const error = new Error('processing_deadline');
    error.status = 503;
    throw error;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(remaining, 4000));
  try {
    const result = await fetchImpl(`${baseUrl}/rest/v1/rpc/process_cakto_webhook`, {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(args),
      signal: controller.signal,
    });
    const raw = await result.text();
    let body;
    try { body = raw ? JSON.parse(raw) : null; } catch { body = null; }
    if (!result.ok) {
      const error = new Error('supabase_rpc_failed');
      error.status = 503;
      throw error;
    }
    return body;
  } catch (error) {
    if (error?.status) throw error;
    const wrapped = new Error('supabase_rpc_unavailable');
    wrapped.status = 503;
    throw wrapped;
  } finally {
    clearTimeout(timer);
  }
}

function rpcArgs(event, item, planId) {
  // The subscription id is needed for renewals AND cancellations. Do not gate it on product.type:
  // a subscription_canceled event for a recurring plan would otherwise never match its subscription.
  const amountCents = moneyToCents(item?.amount);
  const catalogPriceCents = moneyToCents(item?.offer?.price ?? item?.baseAmount);
  const purchaseId = text(item?.id, 128);
  return {
    p_purchase_id: purchaseId,
    p_event_type: event,
    p_email: text(item?.customer?.email, 320).toLowerCase(),
    p_plan_id: planId || null,
    p_amount_cents: amountCents,
    p_catalog_price_cents: catalogPriceCents,
    p_currency: text(item?.currency, 8).toUpperCase(),
    p_product_id: text(item?.product?.id, 120) || null,
    p_offer_id: text(item?.offer?.id, 120) || null,
    p_subscription_id: text(item?.subscription?.id, 160) || null,
  };
}

function resultName(body) {
  if (typeof body === 'string') return body;
  if (Array.isArray(body)) return resultName(body[0]);
  return text(body?.result, 80);
}

const TERMINAL_SUCCESS = new Set([
  'approved', 'already_processed', 'already_approved', 'revoked', 'no_matching_subscription', 'ignored',
]);

export async function handleCaktoWebhook(req, res, deps = {}) {
  const env = deps.env || process.env;
  const fetchImpl = deps.fetchImpl || fetch;
  const nowMs = deps.nowMs || Date.now;
  res.setHeader?.('Cache-Control', 'no-store');
  res.setHeader?.('X-Content-Type-Options', 'nosniff');

  if (req.method !== 'POST') {
    res.setHeader?.('Allow', 'POST');
    return response(res, 405, { ok: false, error: 'method_not_allowed' });
  }

  const secret = String(env.CAKTO_WEBHOOK_SECRET || '');
  if (!secret) return response(res, 503, { ok: false, error: 'webhook_not_configured' });

  let rawBody;
  try {
    rawBody = await readRawBody(req);
  } catch (error) {
    return response(res, error?.status || 400, { ok: false, error: error?.message || 'invalid_body' });
  }

  let payload;
  try { payload = JSON.parse(rawBody.toString('utf8')); } catch {
    return response(res, 400, { ok: false, error: 'invalid_json' });
  }

  const auth = verifyCaktoRequest({
    rawBody,
    headers: req.headers || {},
    payload,
    secret,
    nowMs: nowMs(),
  });
  if (!auth.ok) return response(res, 401, { ok: false, error: 'unauthorized' });

  const event = text(payload.event, 80);
  if (!SUPPORTED_EVENTS.has(event)) return response(res, 200, { ok: true, ignored: true });

  const items = normalizeItems(payload.data);
  if (!items.length || items.length > MAX_ITEMS) {
    return response(res, 400, { ok: false, error: 'invalid_data' });
  }

  // Ignore unpaid/non-final states without ever granting access.
  const finalItems = ACTIVATION_EVENTS.has(event)
    ? items.filter((item) => text(item?.status, 60).toLowerCase() === 'paid')
    : items;
  if (ACTIVATION_EVENTS.has(event) && finalItems.length === 0) {
    return response(res, 200, { ok: true, ignored: true, reason: 'payment_not_paid' });
  }

  const deadline = Date.now() + 5500;
  const results = [];
  let mappedCount = 0;
  for (const item of finalItems) {
    const purchaseId = text(item?.id, 128);
    if (!purchaseId) return response(res, 400, { ok: false, error: 'purchase_id_missing' });

    let planId = null;
    if (ACTIVATION_EVENTS.has(event)) {
      const mapping = mapPurchaseToPlan(item, env);
      if (!mapping.ok) {
        results.push({ result: mapping.reason });
        continue;
      }
      planId = mapping.planId;
      mappedCount += 1;
    }

    try {
      const body = await callSupabaseRpc({
        env,
        fetchImpl,
        args: rpcArgs(event, item, planId),
        deadline,
      });
      const name = resultName(body);
      if (!TERMINAL_SUCCESS.has(name)) {
        const status = name === 'user_not_found' || name === 'plan_not_found' || name === 'catalog_price_mismatch' || name === 'currency_mismatch' || name === 'amount_invalid' || name === 'subscription_not_found' ? 409 : 503;
        return response(res, status, { ok: false, error: name || 'processing_failed' });
      }
      results.push({ result: name });
    } catch (error) {
      return response(res, error?.status || 503, { ok: false, error: error?.message || 'processing_failed' });
    }
  }

  if (ACTIVATION_EVENTS.has(event) && mappedCount === 0) {
    return response(res, 422, { ok: false, error: 'product_not_configured' });
  }
  const unknownMappings = results.filter((entry) => entry.result === 'product_not_configured' || entry.result === 'ambiguous_product_mapping').length;
  return response(res, 200, {
    ok: true,
    processed: results.length - unknownMappings,
    ignoredUnmapped: unknownMappings,
  });
}

export default async function handler(req, res) {
  return handleCaktoWebhook(req, res);
}
