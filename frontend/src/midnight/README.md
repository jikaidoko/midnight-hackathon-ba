# Midnight integration boundary

This folder is intentionally empty in the demo branch.

Replace the mock services in `src/services/mock.ts` with adapters that implement the interfaces from `src/services/contracts.ts`.

Recommended mapping:

- `IdentityService.authenticateVoice()` -> off-chain voice match / credential unlock -> Midnight proof of valid credential.
- `ReportService.sealReport()` -> private report canonicalization -> Compact circuit -> proof -> public commitment / seal.
- `DisclosureService.authorize()` -> selective disclosure authorization for one report and a bounded set of fields.

Keep biometric audio / embeddings outside public state.
