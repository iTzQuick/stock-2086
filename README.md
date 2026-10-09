# Stock 2086

Web app per telefono che trasforma l'export Excel giornaliero **Condensed List** (tessile, calzature e accessori) in uno storico di stock e vendite, con confronti tra un giorno e l'altro.

- Il file viene letto direttamente sul telefono: nessun dato esce dal dispositivo.
- Lo storico è salvato nel browser (IndexedDB). Esporta un backup ogni settimana dalla scheda Report.
- Funziona offline e si installa sulla schermata Home.

## Struttura
- `index.html` — l'app completa (include `src/xlsxparser.js` e `src/engine.js`)
- `src/xlsxparser.js` — lettura del Condensed List
- `src/engine.js` — confronti tra report, eventi, calcoli
- `lib/` — SheetJS 0.18.5
- `sw.js`, `manifest.webmanifest`, `icons/`, `fonts/` — installazione e uso offline

## Pubblicazione
Settings → Pages → Source: *Deploy from a branch* → Branch `main`, cartella `/ (root)`.
