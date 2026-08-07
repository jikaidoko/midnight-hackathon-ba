# AMPARO Demo — Stitch → React/Vite

This project converts the Stitch export into one navigable React + TypeScript + Vite application, preserving the Atmospheric Ethereal visual system while creating clean integration boundaries for Midnight.

## Run

```bash
npm install
npm run dev
```

Production check:

```bash
npm run build
npm run preview
```

## Demo flow

- `/` — identity by voice (mock)
- `/record` — record report (visual mock)
- `/review` — review report
- `/sealing` — deterministic sealing transition
- `/sealed` — success
- `/reports` — reports home
- `/reports/demo-001` — report detail
- `/reports/demo-001/share` — selective disclosure
- `/reports/demo-001/access` — authorized access confirmation

## Architecture

The UI depends on service contracts in `src/services/contracts.ts`.

Current demo uses `src/services/mock.ts`.

Later, implement Midnight adapters under `src/midnight/` and instantiate them behind the same interfaces. This keeps React pages independent from Compact / proof / ledger implementation details.

## Midnight boundary

Recommended technical mapping:

1. Voice capture / matching stays off-chain.
2. Voice authentication unlocks or derives a private credential/secret.
3. Midnight proves possession/validity of that credential without publishing biometric data.
4. Report content remains private; a commitment / seal becomes publicly verifiable.
5. Selective disclosure authorizes only the chosen fields for one report.

## Source references

The original Stitch `code.html`, screenshots, and `DESIGN.md` are preserved under `docs/stitch-reference/`.

## Important

This demo intentionally contains no wallet UX and no real microphone/biometric processing. Those are integration decisions, not presentation dependencies.
