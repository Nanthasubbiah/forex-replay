## What this changes

<!-- One or two sentences. Link the issue if there is one: Fixes #123 -->

## Why

<!-- The reasoning. For simulation changes, spell out the rule you are implementing. -->

## Verification

```bash
npm run typecheck && npm test && npm run build
```

- [ ] Typecheck passes
- [ ] All tests pass
- [ ] Production build passes
- [ ] Added or updated a test for the behaviour change
- [ ] No market-data files (`.json.gz`, `.csv`, `.zip`) added to the tree

## Simulation invariants

- [ ] `src/engine/` and `src/lib/` stay framework-free (no React, no DOM, no storage)
- [ ] No look-ahead introduced (indicator values and strategy fills still lag correctly)
- [ ] Ambiguous intrabar SL/TP still resolves SL-first, gaps still fill at the bar's open

## Screenshots

<!-- For any UI change, drop one in. scripts/ smoke runs can capture it:
     npx vite --port 5199 & CHROME_PATH=/usr/bin/google-chrome node scripts/smoke.mjs -->
