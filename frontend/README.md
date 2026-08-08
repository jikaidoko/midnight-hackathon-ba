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
- `/reports/:caseCommitment` — report detail. The id is a 64-hex case
  commitment, never a slug: an unknown one renders `Caso no encontrado.`
- `/reports/:caseCommitment/share` — selective disclosure (demo only, no circuit)
- `/reports/:caseCommitment/access` — authorized access confirmation
- `/credential` — threshold credential (at least three filings)
- `/control` — oversight portal inbox. Deliberately NOT linked from the reporter
  app, so it is reachable by URL only. This is the only document that says so.
- `/control/:caseCommitment` — case detail and escalation timeline
- `/control/:caseCommitment/respond` — record the control body's answer

## Architecture

The UI depends on service contracts in `src/services/contracts.ts`.

Which implementation runs is decided once, in `src/services/index.ts`, from
`VITE_MN_MODE`. `chain` uses the adapters in `src/midnight/` - real providers,
real proofs, live contract state; anything else uses `src/services/mock.ts`.

That boundary is why the pages never learned which one they are talking to.
Selective disclosure and the voice match have no circuit and are demo stand-ins
in both modes, and both say so on screen. See `src/midnight/README.md`.

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
