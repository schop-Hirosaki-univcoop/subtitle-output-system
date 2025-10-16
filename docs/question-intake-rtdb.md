# Question Intake RTDB Overview

This document summarizes how the question intake tools structure data in Firebase Realtime Database (RTDB) and how that data flows to and from the Google Sheets backing the admin tools.

## Top-Level Layout

All intake data lives under the `questionIntake` branch. The Apps Script `mirrorQuestionIntake_()` routine pushes the current sheet contents into that branch and shapes the structure shown below before issuing a multi-path update.【F:code.gs†L1469-L1707】

```
questionIntake/
  events/{eventId}
  schedules/{eventId}/{scheduleId}
  participants/{eventId}/{scheduleId}/{participantId}
  tokens/{token}
  submissions/{token}/{entryId}
  submissionErrors/{token}/{entryId}
  ...
```

The admin panel primarily interacts with the `events`, `schedules`, `participants`, and `tokens` nodes.

### `questionIntake/events`

Each event document stores identifying metadata:

```json
{
  "name": "春合宿2024",
  "createdAt": 1700000000000,
  "updatedAt": 1700100000000
}
```

These objects are built from the `question_events` sheet while keeping existing timestamps when possible.【F:code.gs†L1470-L1507】

### `questionIntake/schedules`

Schedules are nested under their event and include descriptive fields plus timestamps. When mirroring from the sheet we write keys such as `label`, `date`, `startAt`, `endAt`, `participantCount`, `createdAt`, and `updatedAt`.【F:code.gs†L1510-L1531】

### `questionIntake/participants`

Participant records are stored beneath their event and schedule IDs. Each record keeps contact details, group assignment, and token metadata:

```json
{
  "participantId": "evt123_schA_001",
  "name": "山田 太郎",
  "phonetic": "ヤマダタロウ",
  "furigana": "ヤマダタロウ",
  "gender": "男性",
  "department": "経済学部",
  "phone": "090-1234-5678",
  "email": "taro@example.com",
  "groupNumber": "1",
  "teamNumber": "1",
  "token": "abcd...",
  "guidance": "",
  "updatedAt": 1700101234567
}
```

The mirroring routine preserves existing guidance text, issues or reuses question tokens, and writes every participant entry under `questionIntake/participants/{eventId}/{scheduleId}/{participantId}`.【F:code.gs†L1533-L1666】 Any rows missing from the sheet are removed from RTDB during the same sync.【F:code.gs†L1667-L1687】

### `questionIntake/tokens`

Token documents connect response URLs back to participants. For each participant row we ensure a token exists and update its payload with names, schedule metadata, and expiration fields before pushing it to RTDB.【F:code.gs†L1543-L1696】 Admin tools later rely on this node to fetch the participant when a token is used.

## Sheet Synchronization

Two complementary flows keep RTDB and the spreadsheets aligned:

1. **Sheet ➜ RTDB** – `mirrorQuestionIntake_()` reads the `question_events`, `question_schedules`, and `question_participants` sheets, then overwrites the corresponding branches in RTDB based on those rows.【F:code.gs†L1469-L1707】【F:code.gs†L1968-L2004】
2. **RTDB ➜ Sheet** – `syncQuestionIntakeToSheet_()` pulls the latest RTDB branches and replaces each sheet’s body rows, including the `question_participants` worksheet whose columns match the list you provided (event ID, schedule ID, participant ID, name, furigana, gender, department, phone, email, group number, updated date).【F:code.gs†L1710-L1865】

Because both directions are implemented, the sheet and RTDB stay synchronized whenever the scheduled Apps Script sync runs or an admin triggers a mirror action.

## Admin Panel Consumption

The legacy participant management panel reads directly from `questionIntake/participants/{eventId}/{scheduleId}` and normalizes each record by falling back to the RTDB key as its `participantId`.【F:scripts/question-admin/app.js†L1687-L1732】【F:scripts/question-admin/participants.js†L472-L490】 That keeps the UI aligned with the RTDB hierarchy described above.
