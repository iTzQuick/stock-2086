// Parser del report "Not on Display" (Oracle BI Publisher).
// Ricostruisce la griglia dalle linee della tabella e assegna ogni testo alla sua cella.
(function (root) {
  const MONTHS = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };
  const pad = (n) => String(n).padStart(2, '0');

  function mul(m1, m2) {
    return [
      m1[0] * m2[0] + m1[2] * m2[1], m1[1] * m2[0] + m1[3] * m2[1],
      m1[0] * m2[2] + m1[2] * m2[3], m1[1] * m2[2] + m1[3] * m2[3],
      m1[0] * m2[4] + m1[2] * m2[5] + m1[4], m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
    ];
  }
  const ap = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

  // Estrae segmenti orizzontali/verticali (rettangoli sottili e linee) in coordinate top-down
  async function getSegments(page, OPS, H) {
    const ol = await page.getOperatorList();
    let ctm = [1, 0, 0, 1, 0, 0];
    const stack = [];
    const hs = [], vs = [];
    const addBox = (x0, y0, x1, y1) => {
      const l = Math.min(x0, x1), r = Math.max(x0, x1);
      const t = H - Math.max(y0, y1), b = H - Math.min(y0, y1);
      const w = r - l, h = b - t;
      if (h < 2.5 && w > 5) hs.push({ y: (t + b) / 2, x0: l, x1: r });
      else if (w < 2.5 && h > 5) vs.push({ x: (l + r) / 2, top: t, bottom: b });
    };
    for (let i = 0; i < ol.fnArray.length; i++) {
      const fn = ol.fnArray[i], args = ol.argsArray[i];
      if (fn === OPS.save) stack.push(ctm.slice());
      else if (fn === OPS.restore) ctm = stack.pop() || [1, 0, 0, 1, 0, 0];
      else if (fn === OPS.transform) ctm = mul(ctm, args);
      else if (fn === OPS.constructPath) {
        const ops = args[0], co = args[1];
        let k = 0, cur = null;
        for (const op of ops) {
          if (op === OPS.rectangle) {
            const [x, y, w, h] = co.slice(k, k + 4); k += 4;
            const p1 = ap(ctm, x, y), p2 = ap(ctm, x + w, y + h);
            addBox(p1[0], p1[1], p2[0], p2[1]);
          } else if (op === OPS.moveTo) { cur = ap(ctm, co[k], co[k + 1]); k += 2; }
          else if (op === OPS.lineTo) {
            const p = ap(ctm, co[k], co[k + 1]); k += 2;
            if (cur) {
              if (Math.abs(p[1] - cur[1]) < 0.5) addBox(cur[0], cur[1] - 0.5, p[0], cur[1] + 0.5);
              else if (Math.abs(p[0] - cur[0]) < 0.5) addBox(cur[0] - 0.5, cur[1], cur[0] + 0.5, p[1]);
            }
            cur = p;
          } else if (op === OPS.curveTo) k += 6;
          else if (op === OPS.curveTo2 || op === OPS.curveTo3) k += 4;
        }
      }
    }
    return { hs, vs };
  }

  function uniq(vals, tol) {
    vals.sort((a, b) => a - b);
    const out = [];
    for (const v of vals) if (!out.length || v - out[out.length - 1] > tol) out.push(v);
    return out;
  }

  function buildTables(hs, vs) {
    const groups = new Map();
    for (const v of vs) {
      const key = Math.round(v.top) + ':' + Math.round(v.bottom);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(v);
    }
    const tables = [];
    for (const g of groups.values()) {
      const xs = uniq(g.map((v) => v.x), 2);
      if (xs.length < 3) continue;
      const top = Math.min(...g.map((v) => v.top)), bottom = Math.max(...g.map((v) => v.bottom));
      const ys = uniq(hs.filter((h) => h.y > top - 2 && h.y < bottom + 2 && h.x1 > xs[0] + 5 && h.x0 < xs[xs.length - 1] - 5).map((h) => h.y), 2);
      if (ys.length < 2) continue;
      tables.push({ xs, ys, top });
    }
    tables.sort((a, b) => a.top - b.top);
    return tables;
  }

  function locate(arr, v) {
    for (let i = 0; i < arr.length - 1; i++) if (v >= arr[i] && v < arr[i + 1]) return i;
    return -1;
  }

  function cellLines(items) {
    items.sort((a, b) => a.cy - b.cy || a.x - b.x);
    const lines = [];
    for (const it of items) {
      const L = lines.find((l) => Math.abs(l.cy - it.cy) < it.fs * 0.5);
      if (L) L.items.push(it); else lines.push({ cy: it.cy, items: [it] });
    }
    lines.sort((a, b) => a.cy - b.cy);
    return lines.map((l) => {
      l.items.sort((a, b) => a.x - b.x);
      let s = '', end = null;
      for (const it of l.items) {
        if (end !== null && it.x - end > it.fs * 0.15 && !s.endsWith(' ') && !it.str.startsWith(' ')) s += ' ';
        s += it.str; end = it.x + it.w;
      }
      return { text: s.replace(/\s+/g, ' ').trim(), left: l.items[0].x, right: end };
    }).filter((l) => l.text);
  }

  async function parsePages(pdf, OPS, onProgress) {
    const grids = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const H = page.view[3] - page.view[1];
      const { hs, vs } = await getSegments(page, OPS, H);
      const tables = buildTables(hs, vs);
      const tc = await page.getTextContent();
      const cells = tables.map((t) => Array.from({ length: t.ys.length - 1 }, () => Array.from({ length: t.xs.length - 1 }, () => [])));
      for (const it of tc.items) {
        if (!it.str || !it.str.trim()) continue;
        const tr = it.transform;
        const fs = Math.hypot(tr[2], tr[3]) || it.height || 8;
        const x = tr[4], w = it.width;
        const cy = H - (tr[5] + fs * 0.35), cx = x + w / 2;
        for (let ti = 0; ti < tables.length; ti++) {
          const t = tables[ti];
          const r = locate(t.ys, cy), c = locate(t.xs, cx);
          if (r >= 0 && c >= 0) { cells[ti][r][c].push({ str: it.str, x, w, cy, fs }); break; }
        }
      }
      tables.forEach((t, ti) => {
        grids.push({
          page: p,
          widths: t.xs.slice(1).map((x, i) => x - t.xs[i]),
          rows: cells[ti].map((row) => row.map(cellLines)),
        });
      });
      page.cleanup && page.cleanup();
      if (onProgress) onProgress(p, pdf.numPages);
    }
    return grids;
  }

  // --- normalizzazione celle ---
  const plain = (L) => L.map((l) => l.text).join(' ').trim();
  const code = (L) => L.map((l) => l.text).join('').replace(/\s+/g, ' ').trim();
  function joinHyphen(L) {
    let s = '';
    L.forEach((l, i) => { s += (i && !/[-/]$/.test(s) ? ' ' : '') + l.text; });
    return s.trim();
  }
  // Le descrizioni vanno a capo anche a metà parola ("WH/T", "W/HT$"):
  // un frammento di 1-2 lettere si riattacca alla riga precedente.
  function desc(L) {
    let s = '';
    L.forEach((l, i) => {
      if (i) {
        const core = l.text.replace(/[$'"]+$/, '');
        const glue = /^[A-Za-z]{1,2}$/.test(core) && /[A-Za-z]$/.test(L[i - 1].text);
        s += glue || /\/$/.test(L[i - 1].text) ? '' : ' ';
      }
      s += l.text;
    });
    return s.trim();
  }
  const num = (s) => {
    const v = parseFloat(String(s).replace(/[^0-9.\-]/g, ''));
    return isFinite(v) ? v : 0;
  };
  function shortDate(s) {
    const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})$/.exec(String(s).trim());
    if (!m || !MONTHS[m[2]]) return '';
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    return `${y}-${pad(MONTHS[m[2]])}-${pad(+m[1])}`;
  }
  function headerDate(s) {
    const m = /(\d{1,2}):(\d{2})\s+(\d{1,2})-([A-Za-z]{3})-(\d{4})/.exec(s);
    if (!m) return null;
    return `${m[5]}-${pad(MONTHS[m[4]])}-${pad(+m[3])}T${pad(+m[1])}:${m[2]}`;
  }
  function fragCount(f) {
    if (!f) return 0;
    return f.split(',').reduce((n, part) => {
      const m = /\((\d+)\)\s*$/.exec(part.trim());
      return n + (m ? +m[1] : part.trim() ? 1 : 0);
    }, 0);
  }

  async function parseReport(pdf, OPS, onProgress) {
    const grids = await parsePages(pdf, OPS, onProgress);
    const meta = {}; const rows = []; const warnings = [];
    for (const g of grids) {
      const ncol = g.widths.length;
      for (const row of g.rows) {
        const t = row.map(plain);
        if (ncol === 14) {
          if (t[0] === 'Gender' || !t.join('')) continue;
          const r = {
            gender: plain(row[0]),
            brand: plain(row[1]),
            desc: desc(row[2]),
            style: code(row[3]),
            rrp: num(t[4]), sell: num(t[5]), ptype: t[6].toUpperCase(), qty: num(t[7]),
            frag: joinHyphen(row[8]),
            last: shortDate(t[9]),
            u7: num(t[10]), v7: num(t[11]),
            launch: shortDate(t[12]),
            barcode: code(row[13]),
            page: g.page,
          };
          if (r.gender.startsWith('Returns') || r.brand.startsWith('DUMMY')) { meta.dummyRows = (meta.dummyRows || 0) + 1; continue; }
          if (t[9] && !r.last) warnings.push(`Data ultima vendita non letta: "${t[9]}" (${r.style})`);
          if (r.frag && fragCount(r.frag) !== r.qty) warnings.push(`Taglie non coerenti con Qty per ${r.style}`);
          rows.push(r);
        } else if (ncol === 8 && t[0] !== 'Scan ID' && t.join('')) {
          meta.scanId = t[0];
          meta.completed = headerDate(t[1]);
          meta.by = code(row[2]);
          meta.branchName = plain(row[3]);
          meta.branch = t[4];
          meta.scanned = num(t[5]);
          meta.declaredStyles = num(t[6]);
          meta.declaredValue = num(t[7]);
        }
      }
    }
    // barcode unico come chiave riga
    const seen = {};
    for (const r of rows) {
      const k = r.barcode || `${r.gender}|${r.style}`;
      seen[k] = (seen[k] || 0) + 1;
      r.key = seen[k] > 1 ? `${k}#${seen[k]}` : k;
    }
    const value = Math.round(rows.reduce((s, r) => s + r.qty * r.sell, 0) * 100) / 100;
    const checks = {
      rowsOk: meta.declaredStyles != null && rows.length + (meta.dummyRows || 0) === meta.declaredStyles,
      valueOk: meta.declaredValue != null && Math.abs(value - meta.declaredValue) < 0.5,
      rows: rows.length, dummy: meta.dummyRows || 0, value,
    };
    return { meta, rows, checks, warnings };
  }

  const api = { parseReport, shortDate, fragCount };
  if (typeof module !== 'undefined') module.exports = api; else root.NODParser = api;
})(this);
