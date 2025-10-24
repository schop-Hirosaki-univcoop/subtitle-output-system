# Event/Schedule Isolation Overhaul Plan

## Background
Current operator and display clients all read/write the shared Firebase Realtime Database paths:

- `render/state`
- `render/state/nowShowing`
- `render/session`

This design allows every signed-in operator to overwrite the same telop payload regardless of the event/schedule they are handling. When multiple events are operated concurrently, or when operators unintentionally select different schedules of the same event, the display gets mixed telops.

The goal is to isolate display/operation channels per event (and per schedule when necessary) while keeping day-to-day workflows—multiple operators and a single display URL per assignment—intact.

## Objectives
1. **Event-specific display endpoints** – Each event should have its own `display.html` URL that subscribes only to the event's channel (e.g. `display.html?evt=evt123`).
2. **Schedule-aware isolation** – Displays and operators must agree on the exact `{eventId, scheduleId}` they are manipulating. A mismatch must block telop writes.
3. **Shared awareness UI** – When multiple operators within the same event pick different schedules, they need a coordinated UI (modal + chat) to decide which schedule should stay active, and the system must enforce that decision.
4. **Backward compatibility** – Minimise disruption for single-event operations; default flows should continue to work with sensible fallbacks.

## Progress
- [x] Added shared channel path helpers to compute per-event/per-schedule RTDB locations with legacy fallbacks.
- [x] Updated `display.html` to honour `?evt=`/`?sch=` parameters, resubscribe dynamically, and adopt session-provided assignments.
- [x] Updated operator client Firebase bindings to resolve render/nowShowing references per active `{eventId, scheduleId}` and block send/clear when assignment is missing.
- [x] Persist operator schedule selections to presence nodes (UI modal still pending). Presence writes now land under `operatorPresence/{eventId}/{uid}` with heartbeat refreshes; modal/locking UX remains outstanding.
- [x] Synced operator presence subscriptions with schedule context changes and ensured heartbeat/disconnect cleanup on sign-out.
- [x] Enforce schedule locks at the Apps Script layer with `lockDisplaySchedule_` and assignment preservation.
- [x] Connected the schedule conflict modal and presence roster to the locking workflow so operators can coordinate and resolve mismatches in real time.
- [x] Synced operator presence writes with context updates and drafted Firebase rule coverage for `render/events/*` and `operatorPresence` collections.
- [x] Mirror display schedule locks into `render/events/{eventId}/activeSchedule` so Apps Script sessions expose the active channel state alongside legacy paths.
- [x] Define rotation handling and ACL follow-ups at the Apps Script layer (Apps Script rotation APIs + event-scoped ACL enforcement).

## Scope Overview
- Rework Firebase schema for telop state and sessions.
- Update operator app (`events.html` + `scripts/operator/*`) to target event/schedule-specific references.
- Update display app (`display.html` + `scripts/display/*` if any) to read from the new paths and honour URL-assigned channels.
- Implement shared schedule selection state and modal coordination logic.
- Add server-side/session validation to prevent mismatched writes.

## Detailed Plan

### 1. Firebase Schema Refactor
- Introduce `render/events/{eventId}/{scheduleId}/state` and `render/events/{eventId}/{scheduleId}/nowShowing` nodes.
- Keep a top-level index (e.g. `render/events/{eventId}/activeSchedule`) to record the schedule currently locked to each display session.
- Extend `render/session/{sessionId}` to include assigned `{eventId, scheduleId}`.
- Provide migration script or one-time data move for existing deployments; document manual steps.

### 2. Display Application Update
- Accept `evt` and `sch` parameters via query string (fallback to assigned session info in RTDB if omitted).
- Replace hardcoded references with dynamic ones computed from `{eventId, scheduleId}`.
- Handle reassignment flow: when session assignment changes in RTDB, update listeners or trigger reload.
- Maintain compatibility shim so that legacy URL without params defaults to a safe channel (e.g., read from config document).

### 3. Operator Application Update
- Persist each operator's selected `{eventId, scheduleId}` to a shared RTDB location (e.g., `operatorPresence/{eventId}/{userId}`).
  - ✅ Implemented: operator clients now update `operatorPresence/{eventId}/{uid}` with schedule label, key, and heartbeat timestamps; listeners hydrate local state for forthcoming modal work.
- Ensure operator presence listeners follow event context changes and tear down on auth/session switches.
  - ✅ Implemented: presence subscriptions are re-established whenever `activeEventId` changes, and sign-out clears all timers/disconnect hooks.
- `handleDisplay` and related actions should write to the computed event/schedule path only.
- Implement guard that compares operator-selected schedule with display assignment; block send and surface an error state if mismatched.
- Provide UI indicators showing the display-assigned schedule and other operators' selections.

### 4. Schedule Conflict Modal & Permissions
- When multiple operators of the same event choose different schedules, trigger a modal listing current selections.
- Allow operators to confirm which schedule becomes "display-locked"; the first confirmation (先着順) finalises the choice and updates the display's assignment node.
- For operators not aligned with the locked schedule, disable send/pick-up actions but keep read-only features (e.g., question list filtering, chat).
- Ensure modal interplays well with existing chat sidebar (non-blocking, accessible while decision pending).

### 5. Server/Session Validation (Apps Script)
- Update GAS endpoints to respect session assignments: refuse to change display state if request event/schedule mismatches the session record.
- Provide admin tooling/API to reassign display sessions to a different schedule (with proper logging).

### 6. Documentation & Rollout
- Document the new schema, assignment workflow, and operator responsibilities in `docs/`.
- Update deployment instructions (URLs, query parameters) for display endpoints per event/schedule.
- Communicate migration steps for existing data and sessions.

## Follow-up Considerations

### Multi-schedule rotation on a single display
Some events intentionally cycle through multiple schedules (e.g., a venue display that alternates between morning/afternoon programmes). The event/schedule isolation work keeps a display locked to exactly one `{eventId, scheduleId}`, so this scenario would no longer function without additional features. We will log this as a future enhancement that introduces a "rotation" assignment mode:

- Store a rotation list under `render/events/{eventId}/rotationAssignments`, listing schedule IDs and dwell times.
- Teach the display client to detect the rotation mode (e.g., `activeSchedule.type === "rotation"`) and automatically swap its Firebase listeners on a timer.
- Provide operator tooling to edit the rotation list, with clear UI that the display is not accepting manual schedule locks while rotation is active.
- Ensure the modal flow respects rotation mode by surfacing that the display is currently rotating and by disabling manual overrides unless an operator explicitly cancels the rotation.

This keeps the baseline one-schedule lock behaviour but documents the path to supporting multi-schedule displays when we prioritise it.

### Access control for operator presence data
To show the conflict modal we will persist each operator's selected schedule in RTDB (e.g., `operatorPresence/{eventId}/{userId}`). The intent behind the earlier question was to decide whether we must harden Firebase rules so that operators can only see and mutate presence data for events they are authorised for. Proposed rule changes:

- Scope read/write access to `operatorPresence/{eventId}` by checking membership in the event's operator list (already stored in our auth claims/App Script config).
- Limit writes so an operator can only modify their own presence node (`{userId}`), preventing impersonation or forced schedule switches.
- Gate the modal-triggering cloud functions (if any) behind the same checks to avoid leaking schedule selections to unrelated events.

These restrictions clarify the original question's intent—ensuring that exposing presence data for coordination does not broaden data visibility beyond the current event team.

## Current Focus

- Document the operator presence data contract and embed responsibilities ahead of rollout.

## Rotation assignment APIs & ACL hardening progress

- Added Apps Script endpoints `saveScheduleRotation` / `clearScheduleRotation` to persist `render/events/{eventId}/rotationAssignments` lists and publish a rotation-mode `activeSchedule` record. Rotation entries capture schedule IDs, resolved keys, and optional dwell durations for future display polling logic.
- Enforced event-scoped ACL lookups (`EVENT_OPERATOR_ACL` script property) before allowing schedule locks or rotation mutations, ensuring only authorised operators can alter a display channel for the associated event.
- Clearing or overriding a rotation now removes stale `rotationAssignments` metadata and replaces it with the operator-driven lock state, keeping legacy `render/session` mirrors consistent.

