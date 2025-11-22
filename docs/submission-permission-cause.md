# Question intake submission issue – root cause

Question form submissions were blocked in two cases:

1. **Signed-in non-admin clients:** The prior Realtime Database rule for `questionIntake/submissions/{token}` allowed token-based writes only when `auth == null` or when the caller was an admin. Authenticated non-admin users therefore failed with `PERMISSION_DENIED` even when the token was valid.
2. **Numeric token fields:** Even after loosening the auth requirement, submissions were still rejected when the token's `eventId`, `scheduleId`, or `participantId` were stored as numbers in RTDB. The validation compared these values strictly as strings, so `"123"` from the form did not match a numeric `123` on the token record, triggering `PERMISSION_DENIED` despite a valid token.

Fixes applied:

- Removed the `auth == null` restriction so any valid, non-revoked, non-expired token can create a submission regardless of auth state (admins remain allowed).
- Updated validation to accept either string or numeric token values for `eventId`, `scheduleId`, and `participantId`, preventing type-mismatch false negatives.
