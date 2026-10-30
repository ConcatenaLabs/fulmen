'use strict';
// What a payment or an invoice will do, worked out before anything is sent:
// the asset it moves in, the `maxdelay` the pay call gets, and how long the
// amount can stay locked if the payment cannot complete. Loaded by the
// renderer as a plain script (window.FulmenPlan) and by the tests under Node.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FulmenPlan = api;
})(typeof self !== 'undefined' ? self : this, function () {
  // The lock a pay call allows when nothing asks for more: SeqLN's pay
  // default on Bitcoin, and on Sequentia in builds that do not scale it.
  const BASE_MAXDELAY = 2016;
  // Forwarding hops a route may add on top of the invoice's own final lock.
  const ROUTE_HOPS = 3;

  function isSequentiaNetwork(network) {
    return /^(sequentia|liquid|elements)/.test(network || '');
  }

  // Per network: the most blocks an HTLC may be locked for (lightningd's
  // max_htlc_cltv), a hop's usual cltv delta and the block interval. SeqLN
  // scales Bitcoin's two weeks to Sequentia's one-minute blocks.
  function networkParams(network) {
    return isSequentiaNetwork(network)
      ? { cap: 20160, hopDelta: 270, blockSeconds: 60 }
      : { cap: 2016, hopDelta: 34, blockSeconds: 600 };
  }

  function humanDuration(seconds) {
    const m = Math.round(seconds / 60);
    if (m < 90) return `about ${m} minute${m === 1 ? '' : 's'}`;
    const h = Math.round(seconds / 3600);
    if (h < 48) return `about ${h} hours`;
    const d = Math.round(seconds / 86400 * 10) / 10;
    return `about ${d} days`;
  }

  // decoded: the node's `decode` answer for a BOLT11 invoice.
  // network: the node's network (getinfo.network).
  // chosenAsset: the asset picked in the form ('' for none).
  // nowSeconds: the time now, for the expiry check.
  // Returns { ok: false, reason } or { ok: true, params, ... } where params is
  // exactly what the pay call gets.
  function planPayment(decoded, network, chosenAsset, nowSeconds) {
    const d = decoded || {};
    if (d.type && !/bolt11/i.test(d.type)) return { ok: false, reason: 'Fulmen pays BOLT11 invoices (lnsq…/lntb…).' };
    if (d.valid === false) return { ok: false, reason: 'This invoice is not valid.' };
    if (d.amount_msat == null) return { ok: false, reason: 'This invoice names no amount. Ask the payee for one that does.' };
    const now = nowSeconds == null ? Math.floor(Date.now() / 1000) : nowSeconds;
    if (d.created_at != null && d.expiry != null && d.created_at + d.expiry <= now) {
      return { ok: false, reason: 'This invoice has expired. Ask the payee for a new one.' };
    }
    const net = networkParams(network);
    const finalCltv = Number(d.min_final_cltv_expiry || 18);
    if (finalCltv > net.cap) {
      return { ok: false, reason: `This invoice asks to lock the payment for ${finalCltv} blocks, longer than this network allows (${net.cap}).` };
    }
    // Raise the pay call's limit only as far as this invoice needs, with room
    // for a few forwarding hops; never past the network's own limit.
    const needed = finalCltv + ROUTE_HOPS * net.hopDelta;
    const maxdelay = Math.min(net.cap, Math.max(BASE_MAXDELAY, needed));

    let asset = '';
    if (isSequentiaNetwork(network)) {
      if (d.asset) {
        if (chosenAsset && chosenAsset !== d.asset) {
          return { ok: false, reason: 'This invoice is paid in another asset than the one chosen. It is paid in the asset it names.' };
        }
        asset = d.asset;
      } else if (chosenAsset) {
        asset = chosenAsset;
      } else {
        return { ok: false, reason: 'This invoice names no asset. Choose the asset to pay in.' };
      }
    }
    const params = { bolt11: d.bolt11 || undefined, maxdelay };
    if (asset) params.asset = asset;
    return {
      ok: true,
      params,
      asset,
      amountMsat: String(d.amount_msat),
      payee: d.payee || '',
      finalCltv,
      maxdelay,
      lockBlocks: maxdelay,
      lockText: `If the payment cannot complete, its amount can stay locked for up to ${maxdelay.toLocaleString('en-US')} blocks (${humanDuration(maxdelay * net.blockSeconds)}) before it comes back to you.`,
    };
  }

  // The invoice call's parameters. atoms: a whole number of the asset's
  // atoms (satoshis on Bitcoin), or '' for an invoice of any amount.
  function planInvoice(network, asset, atoms, label, description) {
    const a = String(atoms == null ? '' : atoms).trim();
    if (a && !/^[0-9]+$/.test(a)) return { ok: false, reason: 'The amount is a whole number of atoms.' };
    const params = { amount_msat: a ? `${BigInt(a) * 1000n}msat` : 'any', label, description };
    if (isSequentiaNetwork(network)) {
      if (!asset) return { ok: false, reason: 'Choose the asset this invoice is paid in.' };
      params.asset = asset;
    }
    return { ok: true, params };
  }

  return { BASE_MAXDELAY, ROUTE_HOPS, isSequentiaNetwork, networkParams, humanDuration, planPayment, planInvoice };
});
