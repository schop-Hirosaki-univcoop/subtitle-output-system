# Operator API Client Overview

This document summarizes the current API client implementation used by the operator- and event-admin-facing surfaces, along with credential handling conventions.

## Definition and Responsibilities
- The API client is defined in `scripts/operator/api-client.js`.
- It coordinates Firebase authentication token retrieval and exposes three helpers to consumer modules:
  - `apiPost`
  - `fireAndForgetApi`
  - `logAction`

## Instantiation Sites
- `OperatorApp` creates an instance inside its constructor and assigns it to `this.api` for downstream modules.
- `EventAdminApp` follows the same pattern during its DOM initialization routine, also storing the instance on `this.api`.
- Downstream modules interact with the client exclusively through the owning app’s `api` property. Notable call sites include:
  - Permission checks, initial synchronization, and schedule locking flows.
  - Dictionary CRUD tooling.
  - Pickup tooling.
  - Dialog and question workflows, including log submission utilities.
  - Log retrieval utilities.
  - Event administration features such as administrator detection, schedule locking, and sheet synchronization.

## Initialization Strategy Comparison
| Aspect | Preflight-Layer Initialization | Per-Screen Initialization (Current Baseline) |
| --- | --- | --- |
| Configuration sharing | Centralizes setup but requires additional plumbing to distribute the client to each screen. | Each screen owns its client through `OperatorApp` / `EventAdminApp`, matching existing expectations. |
| Dependency alignment | Shared initialization must manage handoffs between surfaces. | Each class encapsulates its own dependencies via `this.api`. |
| Lifecycle compatibility | Establishing the client before authentication is finalized complicates auth-transfer recovery and embed detection. | Works with `handleAuthState` style flows that manage login transitions and retries. |
| Fault isolation | A failure in the shared initializer affects all screens. | Failures surface per screen, allowing localized error handling and toasts. |

**Current baseline:** We still instantiate the client per screen so the existing flows keep working, while the preflight cache lets each surface skip redundant permission checks when a fresh context is available.【F:scripts/events/app.js†L792-L838】【F:scripts/operator/app.js†L2357-L2436】

**Preflight integration:** `runAuthPreflight` runs immediately after login, warms an API client once, and persists the resulting credential, admin, and mirror metadata for later screens. Event and operator surfaces read this context first and fall back to their local constructors only when no cached data is present.【F:scripts/shared/auth-preflight.js†L161-L245】【F:scripts/events/app.js†L792-L862】【F:scripts/operator/app.js†L2357-L2436】

## Credential Storage and Retrieval (Per-Screen Strategy)
1. **Storage format**
   - Use `sessionStorage` under the key `sos:operatorAuthTransfer`.
   - Persist a JSON payload containing `providerId`, `signInMethod`, `idToken`, `accessToken`, and `timestamp` immediately after successful Google authentication.
2. **Storage timing**
   - Capture the credentials right after login succeeds and before redirecting away from the login surface. Invalid credentials are removed immediately.
3. **Retrieval timing**
   - When `onAuthStateChanged` reports a signed-out state on the event management screen, call `tryResumeAuth` once. It invokes `consumeAuthTransfer`, attempts to sign in with the recovered credential, and clears the storage entry regardless of success.
4. **API request behavior**
   - The per-screen `this.api` instance obtains fresh ID tokens from Firebase Auth for each request. On 401-style responses, it triggers one forced refresh before giving up, so no additional local persistence is required.
5. **Failure handling**
   - If `sessionStorage` is unavailable or the expected payload is missing, the flow abandons auth-transfer recovery and falls back to the standard login path.

