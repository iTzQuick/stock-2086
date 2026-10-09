# Stock 2086

Web app per telefono che trasforma i report PDF giornalieri **Not on Display** in uno storico di stock e vendite, con confronti tra un giorno e l'altro.

- Il PDF viene letto direttamente sul telefono: nessun dato esce dal dispositivo.
- Lo storico è salvato nel browser (IndexedDB). Esporta un backup ogni settimana dalla scheda Report.
- Funziona offline e si installa sulla schermata Home.

## Struttura
- `index.html` — l'app completa (include `src/parser.js` e `src/engine.js`)
- `src/parser.js` — lettura del PDF: ricostruisce la tabella dalle linee della griglia
- `src/engine.js` — confronti tra report, eventi, calcoli
- `lib/` — pdf.js 3.11.174
- `sw.js`, `manifest.webmanifest`, `icons/`, `fonts/` — installazione e uso offline

## Pubblicazione
Settings → Pages → Source: *Deploy from a branch* → Branch `main`, cartella `/ (root)`.
