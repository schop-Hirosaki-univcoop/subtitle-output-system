# Participant Management Overhaul Implementation Plan

## Background
The participant administration UI and backend currently assume `participantId` values that are scoped per `(eventId, scheduleId)` and increment sequentially. The requested changes replace this convention with global `uid` identifiers, adjust how participants are displayed and sorted, and add cross-schedule migration and cancellation behaviors, including downstream impacts on CSV import/export and question handling in Firebase.

## High-Level Goals
1. Stop using `participantId` as the primary identifier and rely exclusively on persistent `uid` values.
2. Present participant rows using a UI-only sequential `No.` column that respects new sorting rules.
3. Allow "cancelled" participants to remain visible in the original schedule (styled and ordered appropriately) while optionally cloning their records into another schedule when moved.
4. Update CSV templates and import/export flows to match the new column definitions.
5. Ensure question submissions (`questions/*`, `questionStatus/*`, and tokens) follow participants when they are reassigned to a different schedule, while leaving them untouched for full cancellations.

## Data Model and Storage Changes
- **Realtime Database keys:** Audit all Firebase paths that currently use `participantId` (e.g., `participants`, `questionIntake/participants`, `questionIntake/tokens`, `questions`, `questionStatus`). Introduce a migration path to use `uid` instead. During transition we may need to support both keys to avoid data loss.
- **UID sourcing:** Confirm `uid` is part of participant payloads for all creation/import flows. Ensure the UID remains stable across schedules.
- **Legacy data migration:** Design a one-time script or background migration (in Apps Script or via admin tools) to copy existing nodes keyed by `participantId` to new `uid` keys, preserving references.
- **Token generation:** Adjust token issuance to use `uid`-based keys; decide how to handle collisions when the same participant appears in multiple schedules.

## UI and Sorting Updates
- **`No.` column rendering:** Update table rendering logic (likely in `scripts/participants.js` or equivalent) to compute display indices after sorting instead of relying on stored IDs. Ensure pagination/export features reuse this computed number.
- **Sorting strategy:** Replace `sortParticipants` with a comparator that prioritizes:
  1. Non-cancelled participants before cancelled ones.
  2. Within each status, numerical `groupNumber` when present (treat missing as `Infinity` so they fall back).
  3. Faculty/department (kana, then kanji if needed).
  4. Name kana, then name display.
  5. Stable tie-breaker on UID.
- **Cancelled styling:** Add CSS classes for cancelled records in source schedule (red theme) and migrated destination (orange). Provide accessible color contrast and update legend/tooltips.
- **Schedule move UI:** Extend edit modal or detail pane to select a destination schedule even when status is "Cancelled". Provide confirmation messaging and indicate that questions will be moved.

## Participant Lifecycle Flows
### Cancellation without relocation
1. Mark participant status as `cancelled` in the current schedule.
2. Push row to end of the list and apply red styling.
3. Do **not** duplicate participant in other schedules.
4. Retain any existing question records under their original schedule path.

### Cancellation with relocation
1. In origin schedule, mark as `cancelled`, append to list, red styling.
2. In destination schedule, insert participant data using destination-specific metadata (schedule ID, group assignment) but reusing the same UID. Apply orange styling until status toggled back to active.
3. Update Firebase nodes for participant info in both schedules.
4. Move question records: copy nodes from origin schedule path to destination; adjust embedded metadata (`scheduleId`, `groupNumber`, etc.). Remove origin entries only if relocation is confirmed, otherwise leave duplicates with status flags.
5. Ensure tokens for the UID reflect the new schedule (either regenerate or update metadata) without breaking existing links.

## CSV Import/Export Adjustments
- **Template update:** Modify template generator to output header: `学部学科,性別,名前,班番号,uid`.
- **Parser changes:** Update CSV parsing order and validations to expect the new header; gracefully reject old formats with explicit error messages.
- **Export alignment:** Ensure export actions produce files in the same column order.
- **Documentation:** Revise any user-facing instructions or tooltips referencing the old two-column template.

## Questions and Token Migration Logic
- **Data mapping:** For each relocation, identify all questions in `questions/normal/<uid>` or related nodes that match the origin schedule; update `eventId`, `scheduleId`, and grouping fields. Apply similar updates for `questionStatus` and token metadata.
- **Atomicity:** Use batched updates (`update()` calls in Apps Script/RTDB) to ensure participant info and question data move together.
- **Audit trails:** Optionally store a log entry on both schedules indicating the cancellation/move action for traceability.

## Implementation Phases
1. **Analysis & scaffolding**
   - Inventory all code paths referencing `participantId`.
   - Introduce feature flags or dual-write helpers to support both IDs during migration.

2. **Backend & data model prep**
   - Implement UID-based read/write APIs in Apps Script.
   - Build migration scripts and run in a staging environment.

3. **Frontend refactor**
   - Update sorting utilities and table rendering to use new comparator and `No.` column.
   - Add styling hooks and cancellation states.
   - Adjust edit forms for relocation workflow.

4. **CSV workflow updates**
   - Revise template generation, parsing, and UI copy.
   - Add regression tests to validate the new format.

5. **Question/token synchronization**
   - Extend save handlers to move associated question data.
   - Add unit/integration tests covering relocation vs full cancellation.

6. **QA & rollout**
   - Verify UI states (normal, cancelled, relocated) with sample data.
   - Ensure CSV import/export and question submissions work end-to-end.
   - Prepare documentation for administrators about the new workflow.

## Risks & Mitigations
- **Data inconsistency during migration:** Use transactional updates and thorough backups before switching keys.
- **User confusion over new colors/order:** Provide legends and update admin documentation.
- **Accessibility of color scheme:** Validate contrast ratios; provide alternative indicators (icons, text labels).
- **Token reuse issues:** Decide whether relocation invalidates old tokens; communicate behavior clearly.

## Next Steps
- Review this plan with stakeholders for validation.
- Prioritize implementation phases and schedule development milestones.
- After approval, begin updating the codebase following the phased approach above.

## Progress Status
- ✅ UI table renders the requested sequential `No.` column, surfaces each UID, and applies the cancellation/relocation styling with
  the new comparator.
- ✅ CSV import/export logic now requires UIDs in both participant and team templates, rejecting rows without them.
- ✅ RTDB writes and token metadata include `uid`, `legacyParticipantId`, and `status` flags so cancellation state survives reloads,
    keeping the backend aligned with the UID-first plan.
- ✅ Cross-schedule relocation UI supports destination selection with cached previews, distinct styling, and relocation metadata for
    both origin and destination schedules.
- ✅ Question and token migration logic moves existing submissions and refreshes token payloads when participants switch schedules,
    keeping Firebase branches consistent.
- ✅ Apps Script mirroring preserves `uid`-based identifiers and the new relocation metadata when syncing participants, avoiding
    regressions during sheet ↔︎ RTDB synchronization.

## Completion Summary

All scoped deliverables in this plan are now implemented in the application, and no additional development tasks are pending. The
admin UI supports cancellation-driven relocations, UID-first management, and the revised CSV formats end-to-end. We recommend
running manual smoke tests for the following scenarios before release:

1. **キャンセルのみ:** 既存の参加者をキャンセルし、No.が末尾へ移動すること・赤色のスタイルが適用されることを確認する。
2. **キャンセルして別日へ移動:** 移動先の日程を選択し、橙色で並び替えられること・質問／トークンが移動先へコピーされることを確認する。
3. **完全キャンセル:** 別日を選択せずに保存し、質問が元日程に残ることとトークンが無効化されることを確認する。
4. **CSVラウンドトリップ:** 新しいヘッダー順の参加者CSVと班番号CSVをダウンロード→編集→再アップロードし、UIDの整合性が保たれることを確かめる。

ログやRealtime Databaseに想定外の残骸が残っていないかも併せて監視し、必要に応じてApps Script側のログを確認してください。
