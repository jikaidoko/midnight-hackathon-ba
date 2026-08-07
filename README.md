# Amparo — canal de denuncias con privacidad

Midnight Hackathon Buenos Aires · 7–8 de agosto de 2026.

Una persona denuncia un caso sin revelar quién es, y aun así el sistema puede
probar dos cosas que hoy exigen exponer al denunciante: que el caso fue **admitido
por una autoridad** de control, y que esa persona **ya denunció N veces** — sin
decir cuántas, ni cuáles, ni quién.

## Estructura

| Ruta | Qué es |
|---|---|
| `contracts/` | Circuitos Compact y su capa TypeScript |
| `contracts/src/case_admission.compact` | Primitiva de admisión de casos |
| `contracts/src/case-registry.ts` | Espejo off-chain del padrón + guard de alineación |
| `contracts/src/*.test.ts` | Tests del simulador (sin proof server) |

## Toolchain

- `compactc` **0.31.0** / language **0.23.0**
- `@midnight-ntwrk/compact-runtime` **0.16.0**
- Node 22

El compilador corre en WSL; los tests corren en Node nativo de Windows.

## Correr

```bash
cd contracts
npm install
npm run compile      # genera src/managed/ con claves prover/verifier
npm test             # tests del simulador
npm run typecheck
```

`npm run compile:fast` saltea la generación de claves ZK (`--skip-zk`): sirve para
el loop rápido mientras se itera el circuito.

## Decisiones que conviene saber antes de leer el código

- **`root()` del ADT MerkleTree es runtime-only.** Verificado contra compactc
  0.31.0: `MerkleTree root is a runtime-only method, but was invoked in-circuit`.
  Si un circuito necesita publicar la root nueva, entra como parámetro.
- **El padrón es `HistoricMerkleTree`, no `MerkleTree`.** `MerkleTree.checkRoot()`
  acepta solo la root actual, así que cada admisión invalidaría el path de todos
  los casos ya admitidos. El ADT histórico acepta roots pasadas.
- **`admittedRoot` es un espejo display-only.** Nadie verifica contra él. La
  verificación de pertenencia va siempre por `admittedCases.checkRoot(...)`.
