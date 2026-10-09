// Lettura degli export Excel "Items Not on Display" e "Condensed List".
// Il Condensed List contiene da solo tessile, calzature e accessori.
(function (root) {
  const GENDER = {
    A: 'Mens Textiles', B: 'Mens Textiles', C: 'Replica Textiles', D: 'Womens Textiles', E: 'Junior Textiles', F: 'Infant Textiles',
    G: 'Accessories',
    K: 'Mens Footwear', L: 'Womens Footwear', M: 'Junior Footwear', N: 'Childrens Footwear', O: 'Infant Footwear',
  };
  const PART_OF = { A: 'T', B: 'T', C: 'T', D: 'T', E: 'T', F: 'T', G: 'A', K: 'F', L: 'F', M: 'F', N: 'F', O: 'F' };
  const PART_NAME = { T: 'Tessile', F: 'Calzature', A: 'Accessori' };
  const MONTHS = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 };
  const pad = (n) => String(n).padStart(2, '0');
  const COLMAP = {
    gender: /^gender$/i, brand: /^brand$/i, desc: /^description$/i, style: /^style( code)?$/i,
    rrp: /^rrp/i, sell: /^sell/i, ptype: /full\/tk\/nt|price type/i, qty: /^qty$/i,
    last: /^last sales? date/i, u7: /^sales units/i, v7: /^sales value/i, launch: /^launch/i,
  };

  function excelDate(v) {
    if (v == null || v === '') return '';
    if (typeof v === 'number') { // numero seriale Excel
      const d = new Date(Math.round((v - 25569) * 86400000));
      return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
    }
    if (v instanceof Date) return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`;
    const s = String(v).trim();
    let m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
    if (m) return `${m[3]}-${pad(+m[2])}-${pad(+m[1])}`;
    m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    return '';
  }
  const num = (v) => { if (typeof v === 'number') return v; const n = parseFloat(String(v ?? '').replace(',', '.').replace(/[^0-9.\-]/g, '')); return isFinite(n) ? n : 0; };
  const str = (v) => (v == null ? '' : String(v)).replace(/\s+/g, ' ').trim();

  // aoa: righe del primo foglio come array di array
  function parseSheet(aoa, filename) {
    const warnings = [];
    let hdrRow = aoa.findIndex((r) => r && r.some((c) => /^gender$/i.test(str(c))) && r.some((c) => /^style/i.test(str(c))));
    if (hdrRow < 0) return { error: `${filename}: non trovo le colonne Gender e Style. Non sembra un export Not on Display.` };
    const titleRow = (aoa.slice(0, hdrRow).find((r) => r && r.some((c) => /Date:/i.test(str(c)))) || []).map(str);
    const title = str(titleRow[0] || (aoa[0] || [])[0]);
    const dRaw = (titleRow.find((c) => /^Date:/i.test(c)) || '').replace(/^Date:/i, '').trim();
    const tRaw = (titleRow.find((c) => /^Time:/i.test(c)) || '').replace(/^Time:/i, '').trim();
    const bRaw = (titleRow.find((c) => /^Branch:/i.test(c)) || '').replace(/^Branch:/i, '').trim();
    const dm = /^(\d{1,2})([A-Z]{3})(\d{2,4})$/i.exec(dRaw);
    const date = dm && MONTHS[dm[2].toUpperCase()] ? `${dm[3].length === 2 ? 2000 + +dm[3] : dm[3]}-${pad(MONTHS[dm[2].toUpperCase()])}-${pad(+dm[1])}` : null;
    const time = /^\d{1,2}:\d{2}$/.test(tRaw) ? tRaw.padStart(5, '0') : '00:00';
    const hdr = aoa[hdrRow].map(str);
    const col = {};
    for (const [k, re] of Object.entries(COLMAP)) col[k] = hdr.findIndex((h) => re.test(h));
    const locCols = hdr.map((h, i) => (/^location/i.test(h) ? i : -1)).filter((i) => i >= 0);
    const missing = ['gender', 'style', 'qty', 'sell'].filter((k) => col[k] < 0);
    if (missing.length) return { error: `${filename}: mancano le colonne ${missing.join(', ')}.` };
    const rows = []; const unknown = new Set(); const parts = new Set();
    for (const r of aoa.slice(hdrRow + 1)) {
      if (!r || !str(r[col.style])) continue;
      const code = str(r[col.gender]).toUpperCase();
      if (!GENDER[code]) unknown.add(code); else parts.add(PART_OF[code]);
      const g = (k) => (col[k] >= 0 ? r[col[k]] : '');
      rows.push({
        gcode: code,
        gender: GENDER[code] || `Codice ${code}`,
        brand: str(g('brand')), desc: str(g('desc')), style: str(g('style')),
        rrp: num(g('rrp')), sell: num(g('sell')), ptype: str(g('ptype')).toUpperCase(), qty: num(g('qty')),
        last: excelDate(g('last')), u7: num(g('u7')), v7: Math.round(num(g('v7')) * 100) / 100, launch: excelDate(g('launch')),
        loc: locCols.map((i) => str(r[i])).filter(Boolean).join(', '),
        frag: '',
      });
    }
    if (unknown.size) warnings.push(`Codici reparto non riconosciuti: ${[...unknown].join(', ')}`);
    const kind = /condensed/i.test(title) || /condensed/i.test(filename) ? 'condensed' : 'part';
    return { kind, title, date, time, branch: bRaw, rows, parts: [...parts], warnings, filename };
  }

  // Unisce righe con stesso reparto e Style Code (es. due linee prezzo dello stesso articolo)
  function consolidate(rows) {
    const map = new Map(); const order = [];
    for (const r of rows) {
      const key = `${r.gcode}|${r.style}`;
      const prev = map.get(key);
      if (!prev) { map.set(key, { ...r, key, lines: 1, mainQty: r.qty }); order.push(key); continue; }
      prev.lines++;
      if (r.qty > prev.mainQty) Object.assign(prev, { rrp: r.rrp, sell: r.sell, ptype: r.ptype, mainQty: r.qty, desc: r.desc });
      prev.qty += r.qty; prev.u7 += r.u7; prev.v7 = Math.round((prev.v7 + r.v7) * 100) / 100;
      if (r.last > prev.last) prev.last = r.last;
      if (r.loc) prev.loc = [...new Set((prev.loc ? prev.loc.split(', ') : []).concat(r.loc.split(', ')))].join(', ');
    }
    return order.map((k) => { const x = map.get(k); delete x.mainQty; return x; });
  }

  // Taglie dal PDF (facoltativo): il PDF le elenca solo fino a 3 pezzi
  function attachSizes(rows, pdfRows) {
    // le uso solo se i pezzi per taglia tornano con la quantità dell'Excel
    const idx = new Map();
    for (const p of pdfRows || []) {
      const k = `${p.gender}|${p.style.replace(/\s+/g, '').toUpperCase()}`;
      const e = idx.get(k) || { frag: [], qty: 0, all: true };
      e.qty += p.qty; if (p.frag) e.frag.push(p.frag); else e.all = false;
      idx.set(k, e);
    }
    let n = 0, partial = 0;
    for (const r of rows) {
      const e = idx.get(`${r.gender}|${r.style.replace(/\s+/g, '').toUpperCase()}`);
      if (!e || !e.frag.length) continue;
      if (e.all && e.qty === r.qty) { r.frag = e.frag.join(', '); n++; } else partial++;
    }
    rows.partialSizes = partial;
    return n;
  }

  // sheets: risultati di parseSheet; pdf: risultato del parser PDF (facoltativo)
  function combine(sheets, pdf) {
    const errors = sheets.filter((s) => s.error).map((s) => s.error);
    const ok = sheets.filter((s) => !s.error);
    if (!ok.length) return { error: errors.join(' ') || 'Nessun file Excel valido.' };
    const condensed = ok.find((s) => s.kind === 'condensed');
    const used = condensed ? [condensed] : ok;
    const ignored = condensed ? ok.filter((s) => s !== condensed).map((s) => s.filename) : [];
    const dates = [...new Set(used.map((s) => s.date))];
    const branches = [...new Set(used.map((s) => s.branch))];
    const warnings = [...errors, ...used.flatMap((s) => s.warnings)];
    if (dates.length > 1) return { error: `I file sono di giorni diversi (${dates.join(', ')}). Carica i file dello stesso giorno.` };
    if (branches.length > 1) return { error: `I file sono di negozi diversi (${branches.join(', ')}).` };
    const parts = new Set(used.flatMap((s) => s.parts));
    const missingParts = ['T', 'F', 'A'].filter((p) => !parts.has(p)).map((p) => PART_NAME[p]);
    const rows = consolidate(used.flatMap((s) => s.rows));
    let sizes = 0;
    const pdfSameDay = pdf && pdf.rows && pdf.meta && pdf.meta.completed && dates[0] && pdf.meta.completed.slice(0, 10) === dates[0];
    if (pdfSameDay) sizes = attachSizes(rows, pdf.rows);
    const time = used.map((s) => s.time).sort().pop();
    const meta = {
      source: 'xlsx', kind: condensed ? 'condensed' : 'parts',
      completed: dates[0] ? `${dates[0]}T${time}` : null,
      branch: branches[0] || '', branchName: '',
      files: used.map((s) => s.filename), ignored,
      sizesFromPdf: sizes, sizesSkipped: rows.partialSizes || 0, pdfDate: pdf && pdf.meta ? pdf.meta.completed : null,
    };
    if (pdf && pdf.meta && pdf.meta.branchName && pdf.meta.branch === meta.branch) meta.branchName = pdf.meta.branchName;
    const value = Math.round(rows.reduce((s, r) => s + r.qty * r.sell, 0) * 100) / 100;
    const checks = { complete: missingParts.length === 0, missingParts, rows: rows.length, value, qty: rows.reduce((s, r) => s + r.qty, 0), dateOk: !!meta.completed };
    if (pdf && pdf.meta && pdf.meta.completed && dates[0] && pdf.meta.completed.slice(0, 10) !== dates[0]) warnings.push(`Il PDF per le taglie è del ${pdf.meta.completed.slice(0, 10)}, gli Excel del ${dates[0]}: taglie non usate.`);
    return { meta, rows, checks, warnings };
  }

  // Legge il primo foglio di una cartella SheetJS. Questi export dichiarano un'area
  // più piccola di quella reale: la ricalcolo dalle celle presenti.
  function sheetRows(XLSX, wb) {
    const ws = wb.Sheets[wb.SheetNames[0]];
    let maxR = 0, maxC = 0;
    for (const k of Object.keys(ws)) {
      if (k[0] === '!') continue;
      const c = XLSX.utils.decode_cell(k);
      if (c.r > maxR) maxR = c.r; if (c.c > maxC) maxC = c.c;
    }
    ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: maxR, c: maxC } });
    return XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
  }

  const api = { parseSheet, combine, consolidate, attachSizes, sheetRows, GENDER };
  if (typeof module !== 'undefined') module.exports = api; else root.NODXlsx = api;
})(this);
