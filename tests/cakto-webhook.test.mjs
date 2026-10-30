import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { Readable } from 'node:stream';
import {
  handleCaktoWebhook,
  mapPurchaseToPlan,
  moneyToCents,
  normalizeItems,
  signatureMatches,
  verifyCaktoRequest,
} from '../api/cakto/webhook.mjs';

const secret = 'unit-test-secret-not-used-in-production';

function makeSignature(body, timestamp, key = secret) {
  const digest = createHmac('sha256', key).update(`${timestamp}.`).update(body).digest('hex');
  return `v1=${digest}`;
}

function mockResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) { this.headers[name] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function makeRequest(method, body, headers = {}) {
  const req = Readable.from([body]);
  req.method = method;
  req.headers = Object.fromEntries(Object.entries(headers).map(([k,v]) => [k.toLowerCase(),v]));
  return req;
}

const env = {
  CAKTO_WEBHOOK_SECRET: secret,
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'not-a-real-key-for-unit-tests',
  CAKTO_BASIC_PRODUCT_ID: 'prod-basic-uuid',
  CAKTO_BASIC_OFFER_ID: 'offer-basic',
  CAKTO_PRO_PRODUCT_ID: 'prod-pro-uuid',
  CAKTO_PRO_OFFER_ID: 'offer-pro',
  CAKTO_PREMIUM_PRODUCT_ID: 'prod-premium-uuid',
  CAKTO_PREMIUM_OFFER_ID: 'offer-premium',
};

function paidData(overrides = {}) {
  return {
    id: 'purchase-001',
    status: 'paid',
    amount: 26.99,
    baseAmount: 26.99,
    currency: 'BRL',
    customer: { email: 'customer@example.com' },
    product: { id: 'prod-pro-uuid', type: 'unique' },
    offer: { id: 'offer-pro', price: 26.99 },
    ...overrides,
  };
}

test('normaliza data como objeto ou lista, incluindo Webhook V2', () => {
  assert.equal(normalizeItems(paidData()).length, 1);
  assert.equal(normalizeItems([paidData(), paidData({ id: 'purchase-002' })]).length, 2);
  assert.equal(normalizeItems(null).length, 0);
});

test('converte valores monetários BRL para centavos sem aceitar entradas inválidas', () => {
  assert.equal(moneyToCents(15.99), 1599);
  assert.equal(moneyToCents('26.99'), 2699);
  assert.equal(moneyToCents(null), null);
  assert.equal(moneyToCents('valor'), null);
});

test('mapeia produto/oferta apenas por IDs explícitos; não adivinha pelo nome', () => {
  assert.deepEqual(mapPurchaseToPlan(paidData(), env), { ok: true, planId: 'pro' });
  assert.equal(mapPurchaseToPlan(paidData({ product: { id: 'unknown' }, offer: { id: 'unknown' } }), env).reason, 'product_not_configured');
  const ambiguous = { ...env, CAKTO_PREMIUM_PRODUCT_ID: 'prod-pro-uuid', CAKTO_PREMIUM_OFFER_ID: 'other' };
  assert.equal(mapPurchaseToPlan(paidData(), ambiguous).reason, 'ambiguous_product_mapping');
});

test('valida segredo no corpo usando comparação em tempo constante', () => {
  const rawBody = Buffer.from(JSON.stringify({ secret, event: 'purchase_approved', data: paidData() }));
  assert.equal(verifyCaktoRequest({ rawBody, payload: JSON.parse(rawBody), secret }).ok, true);
  assert.equal(verifyCaktoRequest({ rawBody, payload: { secret: 'wrong' }, secret }).ok, false);
});

test('valida HMAC v1 com corpo cru e recusa assinatura antiga/inválida', () => {
  const nowMs = 1_800_000_000_000;
  const timestamp = String(Math.floor(nowMs / 1000));
  const body = Buffer.from('{"ok":true}');
  const signature = makeSignature(body, timestamp);
  assert.equal(signatureMatches(body, timestamp, signature, secret, nowMs), true);
  assert.equal(signatureMatches(body, timestamp, 'v1=bad', secret, nowMs), false);
  assert.equal(signatureMatches(body, String(Number(timestamp) - 400), signature, secret, nowMs), false);
});

test('endpoint responde 405 para métodos diferentes de POST', async () => {
  const req = makeRequest('GET', Buffer.from(''));
  const res = mockResponse();
  await handleCaktoWebhook(req, res, { env });
  assert.equal(res.statusCode, 405);
});

test('endpoint valida HMAC, reconhece compra aprovada e chama somente o RPC esperado', async () => {
  const payload = { secret, event: 'purchase_approved', data: paidData() };
  const body = Buffer.from(JSON.stringify(payload));
  const timestamp = String(Math.floor(Date.now() / 1000));
  const req = makeRequest('POST', body, {
    'x-cakto-timestamp': timestamp,
    'x-cakto-signature': makeSignature(body, timestamp),
  });
  const res = mockResponse();
  let rpcBody;
  const fetchImpl = async (url, init) => {
    assert.equal(url, 'https://example.supabase.co/rest/v1/rpc/process_cakto_webhook');
    rpcBody = JSON.parse(init.body);
    return { ok: true, status: 200, text: async () => JSON.stringify({ result: 'approved' }) };
  };
  await handleCaktoWebhook(req, res, { env, fetchImpl });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(rpcBody.p_plan_id, 'pro');
  assert.equal(rpcBody.p_amount_cents, 2699);
  assert.equal(rpcBody.p_catalog_price_cents, 2699);
});

test('endpoint rejects a forged signature before contacting Supabase', async () => {
  const payload = { secret, event: 'purchase_approved', data: paidData() };
  const body = Buffer.from(JSON.stringify(payload));
  const timestamp = String(Math.floor(Date.now() / 1000));
  const req = makeRequest('POST', body, { 'x-cakto-timestamp': timestamp, 'x-cakto-signature': 'v1=wrong' });
  const res = mockResponse();
  let called = false;
  await handleCaktoWebhook(req, res, { env, fetchImpl: async () => { called = true; throw new Error('must not call'); } });
  assert.equal(res.statusCode, 401);
  assert.equal(called, false);
});

test('endpoint flags unmapped products instead of granting an arbitrary plan', async () => {
  const payload = { secret, event: 'purchase_approved', data: paidData({ product: { id: 'unknown' }, offer: { id: 'unknown' } }) };
  const body = Buffer.from(JSON.stringify(payload));
  const req = makeRequest('POST', body);
  const res = mockResponse();
  await handleCaktoWebhook(req, res, { env, fetchImpl: async () => { throw new Error('must not call'); } });
  assert.equal(res.statusCode, 422);
  assert.equal(res.body.error, 'product_not_configured');
});

test('endpoint refuses activation when RPC reports that the user has no account yet', async () => {
  const payload = { secret, event: 'purchase_approved', data: paidData() };
  const body = Buffer.from(JSON.stringify(payload));
  const req = makeRequest('POST', body);
  const res = mockResponse();
  const fetchImpl = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ result: 'user_not_found' }) });
  await handleCaktoWebhook(req, res, { env, fetchImpl });
  assert.equal(res.statusCode, 409);
});

test('SQL draft fail-closes, restricts RPC execution to service_role, and deduplicates external purchases', async () => {
  const { readFile } = await import('node:fs/promises');
  const sql = await readFile(new URL('../db/CAKTO_WEBHOOK_SQL_DRAFT.sql', import.meta.url), 'utf8');
  assert.match(sql, /auth\.jwt\(\)\s*->>\s*'role'/i);
  assert.match(sql, /revoke all on function public\.process_cakto_webhook/i);
  assert.match(sql, /grant execute on function public\.process_cakto_webhook[\s\S]*to service_role/i);
  assert.match(sql, /primary key \(purchase_id, event_type\)/i);
  assert.match(sql, /catalog_price_mismatch/i);
  assert.match(sql, /external_purchase_id/);
});

test('cancelamento envia subscription.id mesmo sem product.type recorrente (regressão)', async () => {
  const data = paidData({ product: { id: 'prod-pro-uuid', type: 'unique' }, subscription: { id: 'sub-123' } });
  const payload = { secret, event: 'subscription_canceled', data };
  const body = Buffer.from(JSON.stringify(payload));
  const req = makeRequest('POST', body);
  const res = mockResponse();
  let rpcBody;
  const fetchImpl = async (_url, init) => {
    rpcBody = JSON.parse(init.body);
    return { ok: true, status: 200, text: async () => JSON.stringify({ result: 'revoked' }) };
  };
  await handleCaktoWebhook(req, res, { env, fetchImpl });
  assert.equal(res.statusCode, 200);
  assert.equal(rpcBody.p_event_type, 'subscription_canceled');
  assert.equal(rpcBody.p_subscription_id, 'sub-123');
  assert.equal(rpcBody.p_plan_id, null);
});

test('reembolso não concede plano e repassa o resultado do RPC', async () => {
  const payload = { secret, event: 'refund', data: paidData({ status: 'refunded' }) };
  const req = makeRequest('POST', Buffer.from(JSON.stringify(payload)));
  const res = mockResponse();
  let rpcBody;
  const fetchImpl = async (_url, init) => {
    rpcBody = JSON.parse(init.body);
    return { ok: true, status: 200, text: async () => JSON.stringify({ result: 'revoked' }) };
  };
  await handleCaktoWebhook(req, res, { env, fetchImpl });
  assert.equal(res.statusCode, 200);
  assert.equal(rpcBody.p_event_type, 'refund');
  assert.equal(rpcBody.p_plan_id, null);
});

test('evento repetido (already_processed) responde 200 sem reativar', async () => {
  const payload = { secret, event: 'purchase_approved', data: paidData() };
  const req = makeRequest('POST', Buffer.from(JSON.stringify(payload)));
  const res = mockResponse();
  const fetchImpl = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ result: 'already_processed' }) });
  await handleCaktoWebhook(req, res, { env, fetchImpl });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
});

test('compra não paga (status pending) não concede acesso nem chama o RPC', async () => {
  const payload = { secret, event: 'purchase_approved', data: paidData({ status: 'pending' }) };
  const req = makeRequest('POST', Buffer.from(JSON.stringify(payload)));
  const res = mockResponse();
  await handleCaktoWebhook(req, res, { env, fetchImpl: async () => { throw new Error('must not call'); } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.reason, 'payment_not_paid');
});
