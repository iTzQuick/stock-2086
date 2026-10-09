// Motore storico: confronta snapshot consecutivi e genera eventi.
// Distingue i DATI DEL REPORT (campi letti dal PDF) dai CALCOLI (differenze, stime).
(function (root) {
  const COLS = ['key', 'gender', 'brand', 'desc', 'style', 'rrp', 'sell', 'ptype', 'qty', 'frag', 'last', 'u7', 'v7', 'launch', 'loc', 'gcode'];
  const pack = (r) => COLS.map((c) => r[c] ?? '');
  const unpack = (a) => {
    const r = {};
    COLS.forEach((c, i) => { r[c] = a[i] ?? ''; });
    r.barcode = String(r.key).includes('|') ? '' : String(r.key).replace(/#\d+$/, '');
    return r;
  };

  const EVENT_TYPES = {
    nuovo: 'Nuovo style',
    tornato: 'Tornato disponibile',
    scomparso: 'Uscito dal report',
    zero: 'Arrivato a zero',
    qty_su: 'Stock in aumento',
    qty_giu: 'Stock in calo',
    prezzo: 'Cambio prezzo',
    rrp: 'Cambio RRP',
    promo: 'Entrato in promo (TK)',
    varprezzo: 'Variazione prezzo (NT)',
    full: 'Tornato Full',
    ptype: 'Cambio Price Type',
    u7: 'Vendite 7gg cambiate',
    v7: 'Valore vendite 7gg cambiato',
    last: 'Nuova data ultima vendita',
    taglie: 'Taglie cambiate',
  };

  const dayDiff = (a, b) => Math.round((Date.parse(a) - Date.parse(b)) / 86400000);
  const r2 = (n) => Math.round(n * 100) / 100;

  function ptypeEvent(a, b) {
    if (a === b) return null;
    if (b === 'FULL') return 'full';
    if (a === 'FULL' && b === 'TK') return 'promo';
    if (a === 'FULL' && b === 'NT') return 'varprezzo';
    return 'ptype';
  }

  function diffPair(prev, cur, i, seenBefore) {
    const ev = [];
    const base = (r) => ({ i, key: r.key, style: r.style, desc: r.desc, brand: r.brand, gender: r.gender });
    const push = (r, type, field, old, nw, delta) => ev.push({ ...base(r), type, field, old, nw, delta: delta ?? null });
    for (const [k, c] of cur) {
      const p = prev.get(k);
      if (!p) {
        push(c, seenBefore.has(k) ? 'tornato' : 'nuovo', 'qty', null, c.qty, null);
        continue;
      }
      if (c.qty !== p.qty) {
        if (c.qty === 0) push(c, 'zero', 'qty', p.qty, 0, -p.qty);
        else push(c, c.qty > p.qty ? 'qty_su' : 'qty_giu', 'qty', p.qty, c.qty, c.qty - p.qty);
      }
      if (c.sell !== p.sell) push(c, 'prezzo', 'sell', p.sell, c.sell, r2(c.sell - p.sell));
      if (c.rrp !== p.rrp && c.ptype === p.ptype) push(c, 'rrp', 'rrp', p.rrp, c.rrp, r2(c.rrp - p.rrp));
      const pt = ptypeEvent(p.ptype, c.ptype);
      if (pt) push(c, pt, 'ptype', p.ptype, c.ptype, null);
      if (c.u7 !== p.u7) push(c, 'u7', 'u7', p.u7, c.u7, c.u7 - p.u7);
      if (c.v7 !== p.v7) push(c, 'v7', 'v7', p.v7, c.v7, r2(c.v7 - p.v7));
      if (c.last !== p.last) push(c, 'last', 'last', p.last || null, c.last || null, null);
      if (c.frag !== p.frag) push(c, 'taglie', 'frag', p.frag || null, c.frag || null, null);
    }
    for (const [k, p] of prev) if (!cur.has(k)) push(p, 'scomparso', 'qty', p.qty, null, -p.qty);
    return ev;
  }

  // snaps: [{meta, rows:[obj]}] dello stesso branch
  function buildModel(snaps) {
    const s = snaps.slice().sort((a, b) => String(a.meta.completed).localeCompare(String(b.meta.completed)));
    const model = { snaps: s.map((x) => ({ meta: x.meta, map: new Map(x.rows.map((r) => [r.key, r])) })), events: [], firstSeen: new Map() };
    const seen = new Set();
    model.snaps.forEach((sn, i) => {
      if (i > 0) model.events.push(...diffPair(model.snaps[i - 1].map, sn.map, i, seen));
      for (const k of sn.map.keys()) { if (!seen.has(k)) { seen.add(k); model.firstSeen.set(k, i); } }
    });
    model.eventsByKey = new Map();
    for (const e of model.events) {
      if (!model.eventsByKey.has(e.key)) model.eventsByKey.set(e.key, []);
      model.eventsByKey.get(e.key).push(e);
    }
    return model;
  }

  // Stima vendite tra due snapshot (CALCOLO, non dato del report):
  // c'è stata almeno una vendita se la data di ultima vendita è avanzata
  // o, nello stesso giorno, se le vendite 7gg sono aumentate;
  // in quel caso la stima è il calo di stock, minimo 1.
  function estSales(p, c) {
    if (!p || !c) return null;
    const advanced = c.last && (!p.last || c.last > p.last);
    const u7up = c.u7 > p.u7;
    if (!advanced && !u7up) return 0;
    return Math.max(1, p.qty - c.qty, u7up && !advanced ? c.u7 - p.u7 : 0);
  }

  function history(model, key) {
    const out = [];
    let prev = null;
    model.snaps.forEach((sn, i) => {
      const r = sn.map.get(key) || null;
      out.push({ i, meta: sn.meta, row: r, delta: r && prev ? r.qty - prev.qty : null, est: prev && r ? estSales(prev, r) : null });
      prev = r;
    });
    return out;
  }

  // Righe dello snapshot i arricchite con i calcoli, confrontate con lo snapshot base (default: il precedente)
  function rowsAt(model, i, base) {
    const sn = model.snaps[i];
    if (!sn) return [];
    if (base == null) base = i - 1;
    const prev = base >= 0 ? model.snaps[base].map : null;
    const first = model.snaps[0].map;
    const out = [];
    for (const r of sn.map.values()) {
      const p = prev ? prev.get(r.key) : null;
      const fs = model.firstSeen.get(r.key);
      const f = first.get(r.key) || model.snaps[fs].map.get(r.key);
      let est = 0;
      for (let j = 1; j <= i; j++) est += estSales(model.snaps[j - 1].map.get(r.key), model.snaps[j].map.get(r.key)) || 0;
      out.push({
        ...r,
        calc: {
          prevQty: p ? p.qty : null,
          dPrev: p ? r.qty - p.qty : null,
          firstQty: f.qty,
          firstIdx: fs,
          fromDay1: first.has(r.key),
          dFirst: r.qty - f.qty,
          discount: r.rrp > 0 ? Math.round((1 - r.sell / r.rrp) * 100) : null,
          stockValue: r2(r.qty * r.sell),
          estSales: i > 0 ? est : null,
          daysSinceSale: r.last ? dayDiff(sn.meta.completed.slice(0, 10), r.last) : null,
          isNew: prev ? !p : false,
        },
      });
    }
    return out;
  }

  function seenUpTo(model, j) {
    const seen = new Set();
    for (let k = 0; k <= j; k++) for (const key of model.snaps[k].map.keys()) seen.add(key);
    return seen;
  }

  function summary(model, i, opts, base) {
    const o = Object.assign({ low: 2, oldDays: 60, bigAbs: 5, bigPct: 50 }, opts || {});
    if (base == null) base = i - 1;
    const rows = rowsAt(model, i, base);
    const ev = base === i - 1 ? model.events.filter((e) => e.i === i)
      : base >= 0 ? diffPair(model.snaps[base].map, model.snaps[i].map, i, seenUpTo(model, base)) : [];
    const by = (t) => ev.filter((e) => t.includes(e.type));
    const meta = model.snaps[i].meta;
    const styles = new Set(rows.map((r) => r.style));
    const withDelta = rows.filter((r) => r.calc.dPrev);
    return {
      meta,
      hasPrev: base >= 0,
      base,
      rows,
      stock: {
        qty: rows.reduce((s, r) => s + r.qty, 0),
        value: meta.declaredValue ?? r2(rows.reduce((s, r) => s + r.qty * r.sell, 0)),
        rows: rows.length,
        styles: styles.size,
        out: by(['scomparso', 'zero']),
        low: rows.filter((r) => r.qty > 0 && r.qty <= o.low).sort((a, b) => a.qty - b.qty || b.u7 - a.u7),
        up: withDelta.filter((r) => r.calc.dPrev > 0).sort((a, b) => b.calc.dPrev - a.calc.dPrev),
        down: withDelta.filter((r) => r.calc.dPrev < 0).sort((a, b) => a.calc.dPrev - b.calc.dPrev),
      },
      sales: {
        u7: rows.reduce((s, r) => s + r.u7, 0),
        v7: r2(rows.reduce((s, r) => s + r.v7, 0)),
        top: rows.filter((r) => r.u7 > 0).sort((a, b) => b.u7 - a.u7 || b.v7 - a.v7),
        none: rows.filter((r) => r.u7 === 0),
        recent: rows.filter((r) => r.last).sort((a, b) => b.last.localeCompare(a.last) || b.u7 - a.u7),
        old: rows.filter((r) => r.calc.daysSinceSale !== null && r.calc.daysSinceSale > o.oldDays).sort((a, b) => b.calc.daysSinceSale - a.calc.daysSinceSale),
        noDate: rows.filter((r) => !r.last),
      },
      prices: { promo: by(['promo']), varprezzo: by(['varprezzo']), full: by(['full']), change: by(['prezzo']), ptype: by(['ptype']) },
      news: {
        nuovi: by(['nuovo']),
        tornati: by(['tornato']),
        usciti: by(['scomparso', 'zero']),
        big: ev.filter((e) => (e.type === 'qty_su' || e.type === 'qty_giu') && (Math.abs(e.delta) >= o.bigAbs || (e.old > 0 && Math.abs(e.delta) / e.old * 100 >= o.bigPct && Math.abs(e.delta) >= 2))),
      },
      events: ev,
    };
  }

  const api = { COLS, pack, unpack, buildModel, history, rowsAt, summary, estSales, EVENT_TYPES, diffPair };
  if (typeof module !== 'undefined') module.exports = api; else root.NODEngine = api;
})(this);
