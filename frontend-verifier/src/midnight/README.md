# Midnight integration boundary

The UI is intentionally decoupled from the Midnight SDK and Compact contracts.

Replace the mock services with concrete adapters that implement:

- `VerificationService.verifyCondition(condition)`
  - Obtain/construct the necessary private witness without exposing report history to the verifier UI.
  - Invoke the Compact contract/circuit that proves the threshold condition.
  - Return only the boolean result and safe proof metadata to the UI.

- `AuthorizedAccessService.getAuthorizedReport(reportId)`
  - Resolve an authorization/disclosure grant.
  - Return only fields the reporter explicitly shared.
  - Never return hidden fields as redacted values; omit them and surface only their privacy state.

Do not call Midnight SDK functions directly from React page components.
