'use strict';
// node --test: what Pay and Receive send, worked out from a decoded invoice.
const test = require('node:test');
const assert = require('node:assert');
const { planPayment, planInvoice, BASE_MAXDELAY } = require('../src/renderer/payplan.js');
const { renderConfig } = require('../src/main/node.js');

const USDX = '2a515539da5e6a60caa7766ecd65bac0c10d15717ddd2088844ba58f4d04b9de';
const GOLD = '3a0f9192219db59f8d7f87d93ac6311095dfe1255d149727b87baaa7d2cc71a1';
const NOW = 1_800_000_000;
const inv = (o) => Object.assign({ type: 'bolt11 invoice', valid: true, bolt11: 'lntsqt1x', amount_msat: 10_000_000, created_at: NOW - 10, expiry: 3600, min_final_cltv_expiry: 180, payee: '03ab' }, o);

test('an ordinary invoice keeps the usual limit of 2016 blocks', () => {
  const p = planPayment(inv({ asset: USDX }), 'sequentia-testnet', '', NOW);
  assert.ok(p.ok);
  assert.strictEqual(p.params.maxdelay, BASE_MAXDELAY);
  assert.strictEqual(p.params.asset, USDX);
  assert.match(p.lockText, /2,016 blocks \(about 34 hours\)/);
});

test("an Ark operator's receive invoice raises maxdelay only as far as it needs", () => {
  // An operator's receive: about 5,780 blocks of final lock time.
  const p = planPayment(inv({ asset: USDX, min_final_cltv_expiry: 5780 }), 'sequentia-testnet', '', NOW);
  assert.ok(p.ok);
  assert.strictEqual(p.params.maxdelay, 5780 + 3 * 270);
  assert.ok(p.params.maxdelay < 20160);
  assert.match(p.lockText, /6,590 blocks \(about 4\.6 days\)/);
});

test('a final lock past the network limit is refused before paying', () => {
  const p = planPayment(inv({ asset: USDX, min_final_cltv_expiry: 20161 }), 'sequentia-testnet', '', NOW);
  assert.strictEqual(p.ok, false);
  assert.match(p.reason, /longer than this network allows \(20160\)/);
});

test('the route margin never takes maxdelay past the network limit', () => {
  const p = planPayment(inv({ asset: USDX, min_final_cltv_expiry: 20000 }), 'sequentia-testnet', '', NOW);
  assert.strictEqual(p.params.maxdelay, 20160);
});

test('the invoice names the asset; a different choice is refused', () => {
  const p = planPayment(inv({ asset: USDX }), 'sequentia-testnet', GOLD, NOW);
  assert.strictEqual(p.ok, false);
  assert.match(p.reason, /another asset/);
});

test('an invoice that names no asset needs a choice: no asset is assumed', () => {
  assert.strictEqual(planPayment(inv({}), 'sequentia-testnet', '', NOW).ok, false);
  const p = planPayment(inv({}), 'sequentia-testnet', GOLD, NOW);
  assert.strictEqual(p.params.asset, GOLD);
});

test('on Bitcoin there is no asset, and the cap is 2016', () => {
  const p = planPayment(inv({ bolt11: 'lntb1x', min_final_cltv_expiry: 144 }), 'testnet4', USDX, NOW);
  assert.ok(p.ok);
  assert.strictEqual(p.params.asset, undefined);
  assert.strictEqual(p.params.maxdelay, 2016);
  assert.match(p.lockText, /about 14 days/);
  assert.strictEqual(planPayment(inv({ min_final_cltv_expiry: 2017 }), 'testnet4', '', NOW).ok, false);
});

test('expired, invalid and amountless invoices are refused', () => {
  assert.match(planPayment(inv({ asset: USDX, created_at: NOW - 4000 }), 'sequentia-testnet', '', NOW).reason, /expired/);
  assert.match(planPayment(inv({ valid: false }), 'sequentia-testnet', '', NOW).reason, /not valid/);
  assert.match(planPayment(inv({ amount_msat: undefined }), 'sequentia-testnet', '', NOW).reason, /no amount/);
});

test('an invoice on Sequentia names its asset; on Bitcoin none', () => {
  assert.strictEqual(planInvoice('sequentia-testnet', '', '100', 'l', 'd').ok, false);
  const s = planInvoice('sequentia-testnet', USDX, '500000000', 'l', 'd');
  assert.deepStrictEqual(s.params, { amount_msat: '500000000000msat', label: 'l', description: 'd', asset: USDX });
  const b = planInvoice('testnet4', USDX, '', 'l', 'd');
  assert.deepStrictEqual(b.params, { amount_msat: 'any', label: 'l', description: 'd' });
  assert.strictEqual(planInvoice('testnet4', '', '1.5', 'l', 'd').ok, false);
});

test("the node's config takes no inbound connections", () => {
  const c = renderConfig({ network: 'sequentia-testnet', backend: { host: '127.0.0.1', port: 18884, user: 'u', pass: 'p' }, cliPath: '/x/elements-cli' });
  assert.match(c, /^network=sequentia-testnet\nautolisten=false\n/);
});
