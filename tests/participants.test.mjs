import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeGroupNumberValue,
  resolveParticipantUid,
  resolveParticipantStatus,
  formatParticipantIdDisplay,
  resolveMailStatusKey,
  resolveMailStatusInfo,
  isMailDeliveryPending,
  sortParticipants,
  snapshotParticipantList,
  diffParticipantFields,
  diffParticipantLists,
  signatureForEntries,
  ensureRowKey,
  participantIdentityKey,
  duplicateKeyFor,
  parseParticipantRows,
  parseTeamAssignmentRows,
  normalizeParticipantRecord,
  assignParticipantIds,
  applyAssignmentsToEntries,
  ensureTeamAssignmentMap,
  getTeamAssignmentMap,
  normalizeEventParticipantCache,
  describeDuplicateMatch
} from '../scripts/question-admin/participants.js';

test('normalizeGroupNumberValue normalizes group number values', () => {
  assert.equal(normalizeGroupNumberValue('1班'), '1班');
  assert.equal(normalizeGroupNumberValue('1'), '1班');
  assert.equal(normalizeGroupNumberValue('  1班  '), '1班');
  assert.equal(normalizeGroupNumberValue('１２班'), '12班');
  assert.equal(normalizeGroupNumberValue(''), '');
  assert.equal(normalizeGroupNumberValue(null), '');
});

test('resolveParticipantUid resolves participant UID', () => {
  const entry = { uid: 'uid-123', participantId: 'pid-456' };
  assert.equal(resolveParticipantUid(entry), 'uid-123');
  
  const entry2 = { participantId: 'pid-456' };
  assert.equal(resolveParticipantUid(entry2), 'pid-456');
  
  assert.equal(resolveParticipantUid(null, 'fallback'), 'fallback');
  assert.equal(resolveParticipantUid({}, ''), '');
});

test('resolveParticipantStatus resolves participant status', () => {
  assert.equal(resolveParticipantStatus({ status: 'cancelled' }, ''), 'cancelled');
  assert.equal(resolveParticipantStatus({ status: 'relocated' }, ''), 'relocated');
  assert.equal(resolveParticipantStatus({ relocated: true }, ''), 'relocated');
  assert.equal(resolveParticipantStatus({}, '1班'), 'active');
  assert.equal(resolveParticipantStatus({}, ''), 'active');
});

test('formatParticipantIdDisplay formats participant ID for display', () => {
  // formatParticipantIdDisplay は長いIDの末尾を返す
  assert.equal(formatParticipantIdDisplay('abc123def456'), '456');
  assert.equal(formatParticipantIdDisplay('short'), 'short');
  assert.equal(formatParticipantIdDisplay(''), '');
  assert.equal(formatParticipantIdDisplay(null), '');
});

test('resolveMailStatusKey resolves mail status key', () => {
  // email が空の場合は 'missing'
  assert.equal(resolveMailStatusKey({ email: '', mailStatus: 'sent' }), 'missing');
  // 'sent' の場合は mailSentAt > 0 が必要
  assert.equal(resolveMailStatusKey({ email: 'test@example.com', mailStatus: 'sent', mailSentAt: Date.now() }), 'sent');
  assert.equal(resolveMailStatusKey({ email: 'test@example.com', mailStatus: 'sent' }), 'pending'); // mailSentAt がない
  assert.equal(resolveMailStatusKey({ email: 'test@example.com', mailStatus: 'error' }), 'error');
  assert.equal(resolveMailStatusKey({ email: 'test@example.com', mailStatus: 'pending' }), 'pending');
  // mailStatus がない場合は 'pending'
  assert.equal(resolveMailStatusKey({ email: 'test@example.com' }), 'pending');
});

test('resolveMailStatusInfo resolves mail status info', () => {
  const info1 = resolveMailStatusInfo({ email: 'test@example.com', mailStatus: 'sent', mailSentAt: Date.now() });
  assert.equal(info1.key, 'sent');
  assert.equal(info1.label, 'メール送信済');
  
  const info2 = resolveMailStatusInfo({ email: '' });
  assert.equal(info2.key, 'missing');
  assert.equal(info2.label, 'メール未設定');
});

test('isMailDeliveryPending checks if mail delivery is pending', () => {
  assert.equal(isMailDeliveryPending({ email: 'test@example.com', mailStatus: 'pending' }), true);
  assert.equal(isMailDeliveryPending({ email: 'test@example.com', mailStatus: 'error' }), true);
  // 'sent' の場合は mailSentAt > 0 が必要で、それがない場合は 'pending' になる
  const now = Date.now();
  assert.equal(isMailDeliveryPending({ email: 'test@example.com', mailStatus: 'sent', mailSentAt: now }), false);
  assert.equal(isMailDeliveryPending({ email: 'test@example.com', mailStatus: 'sent' }), true); // mailSentAt がない
  // email が空の場合は 'missing' となり、pending ではない
  assert.equal(isMailDeliveryPending({ email: '' }), false);
});

test('sortParticipants sorts participants', () => {
  const entries = [
    { name: 'Bさん', participantId: '2' },
    { name: 'Aさん', participantId: '1' },
    { name: 'Cさん', participantId: '3' }
  ];
  const sorted = sortParticipants(entries);
  assert.equal(sorted[0].name, 'Aさん');
  assert.equal(sorted[1].name, 'Bさん');
  assert.equal(sorted[2].name, 'Cさん');
});

test('snapshotParticipantList creates snapshots', () => {
  const entries = [
    { participantId: '1', name: 'テスト', email: 'test@example.com' }
  ];
  const snapshots = snapshotParticipantList(entries);
  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0].participantId, '1');
  assert.equal(snapshots[0].name, 'テスト');
});

test('diffParticipantFields detects field changes', () => {
  const previous = { name: 'Aさん', email: 'a@example.com' };
  const current = { name: 'Bさん', email: 'a@example.com' };
  const changes = diffParticipantFields(previous, current);
  assert(changes.length > 0);
  assert(changes.some(c => c.field === 'name'));
});

test('diffParticipantLists detects list differences', () => {
  const current = [{ participantId: '1', name: 'Aさん' }];
  const baseline = [{ participantId: '1', name: 'Bさん' }];
  const diff = diffParticipantLists(current, baseline);
  assert('added' in diff);
  assert('updated' in diff);
  assert('removed' in diff);
});

test('signatureForEntries creates signature', () => {
  const entries = [
    { participantId: '1', name: 'テスト' }
  ];
  const signature = signatureForEntries(entries);
  assert(typeof signature === 'string');
  assert(signature.length > 0);
});

test('ensureRowKey ensures row key', () => {
  const entry = { name: 'テスト' };
  const result = ensureRowKey(entry);
  assert('rowKey' in result);
  assert(typeof result.rowKey === 'string');
  assert(result.rowKey.length > 0);
});

test('participantIdentityKey creates identity key', () => {
  const entry = { name: 'テスト', phonetic: 'てすと', department: '工学部' };
  const key = participantIdentityKey(entry);
  assert(typeof key === 'string');
  assert(key.includes('テスト'));
});

test('duplicateKeyFor creates duplicate key', () => {
  const entry = { name: 'テスト', department: '工学部' };
  const key = duplicateKeyFor(entry);
  assert(typeof key === 'string');
  assert(key.length > 0);
});

test('parseParticipantRows parses participant rows from CSV', () => {
  const rows = [
    ['名前', 'フリガナ', '性別', '学部学科', '携帯電話', 'メールアドレス'],
    ['テスト太郎', 'てすとたろう', '男', '工学部', '090-1234-5678', 'test@example.com']
  ];
  const entries = parseParticipantRows(rows);
  assert(Array.isArray(entries));
  assert.equal(entries.length, 1);
  assert.equal(entries[0].name, 'テスト太郎');
  assert.equal(entries[0].phonetic, 'てすとたろう');
});

test('parseParticipantRows throws error for empty rows', () => {
  assert.throws(() => parseParticipantRows([]), /CSVにデータがありません/);
});

test('parseParticipantRows throws error for missing name', () => {
  const rows = [
    ['名前', 'フリガナ'],
    ['', 'てすとたろう']
  ];
  assert.throws(() => parseParticipantRows(rows), /氏名のない行があります/);
});

test('parseTeamAssignmentRows parses team assignment rows', () => {
  const rows = [
    ['uid', '班'],
    ['uid-1', '1班'],
    ['uid-2', '2班']
  ];
  const assignments = parseTeamAssignmentRows(rows);
  assert(assignments instanceof Map);
  assert.equal(assignments.get('uid-1'), '1班');
  assert.equal(assignments.get('uid-2'), '2班');
});

test('parseTeamAssignmentRows throws error for empty rows', () => {
  assert.throws(() => parseTeamAssignmentRows([]), /CSVにデータがありません/);
});

test('normalizeParticipantRecord normalizes participant record', () => {
  const entry = {
    uid: 'uid-123',
    name: 'テスト太郎',
    phonetic: 'てすとたろう',
    gender: '男',
    department: '工学部',
    groupNumber: '1班',
    phone: '090-1234-5678',
    email: 'test@example.com'
  };
  const record = normalizeParticipantRecord(entry);
  assert.equal(record.uid, 'uid-123');
  assert.equal(record.name, 'テスト太郎');
  assert.equal(record.phonetic, 'てすとたろう');
  assert.equal(record.groupNumber, '1班');
});

test('assignParticipantIds assigns participant IDs', () => {
  const entries = [
    { name: 'テスト太郎' },
    { name: 'テスト花子' }
  ];
  const assigned = assignParticipantIds(entries);
  assert(Array.isArray(assigned));
  assert.equal(assigned.length, 2);
  assert(assigned[0].participantId);
  assert(assigned[1].participantId);
});

test('applyAssignmentsToEntries applies assignments to entries', () => {
  const entries = [
    { participantId: 'uid-1', groupNumber: '' },
    { participantId: 'uid-2', groupNumber: '' }
  ];
  const assignmentMap = new Map([
    ['uid-1', '1班'],
    ['uid-2', '2班']
  ]);
  const result = applyAssignmentsToEntries(entries, assignmentMap);
  assert.equal(result.entries[0].groupNumber, '1班');
  assert.equal(result.entries[1].groupNumber, '2班');
  assert(result.matchedIds instanceof Set);
  assert(result.updatedIds instanceof Set);
});

test('ensureTeamAssignmentMap ensures team assignment map', () => {
  // ensureTeamAssignmentMap は state に依存しているため、モックが必要
  // ただし、この関数は state を直接操作するため、テストは後回し
  // ここでは関数が存在することを確認
  assert(typeof ensureTeamAssignmentMap === 'function');
});

test('getTeamAssignmentMap gets team assignment map', () => {
  // getTeamAssignmentMap は state に依存しているため、モックが必要
  // ただし、この関数は state を直接操作するため、テストは後回し
  // ここでは関数が存在することを確認
  assert(typeof getTeamAssignmentMap === 'function');
});

test('normalizeEventParticipantCache normalizes event participant cache', () => {
  const eventBranch = {
    'schedule-1': {
      'participant-1': {
        uid: 'uid-1',
        name: 'テスト太郎',
        groupNumber: '1班'
      },
      'participant-2': {
        name: 'テスト花子',
        groupNumber: '2班'
      }
    },
    'schedule-2': {
      'participant-3': {
        name: 'テスト次郎'
      }
    }
  };
  const cache = normalizeEventParticipantCache(eventBranch);
  assert(typeof cache === 'object');
  assert(Array.isArray(cache['schedule-1']));
  assert.equal(cache['schedule-1'].length, 2);
  assert.equal(cache['schedule-1'][0].name, 'テスト太郎');
  assert.equal(cache['schedule-1'][0].scheduleId, 'schedule-1');
  assert(Array.isArray(cache['schedule-2']));
  assert.equal(cache['schedule-2'].length, 1);
});

test('normalizeEventParticipantCache handles empty input', () => {
  const cache1 = normalizeEventParticipantCache(null);
  assert(typeof cache1 === 'object');
  
  const cache2 = normalizeEventParticipantCache({});
  assert(typeof cache2 === 'object');
  
  const cache3 = normalizeEventParticipantCache({ 'schedule-1': null });
  assert(Array.isArray(cache3['schedule-1']));
  assert.equal(cache3['schedule-1'].length, 0);
});

test('describeDuplicateMatch describes duplicate match', () => {
  // describeDuplicateMatch は getScheduleLabel に依存しているが、
  // getScheduleLabel が空文字を返す場合でも動作する
  const match1 = {
    participantId: 'pid-1',
    name: 'テスト太郎',
    scheduleId: 'schedule-1'
  };
  const result1 = describeDuplicateMatch(match1, 'event-1', 'schedule-2');
  assert(typeof result1 === 'string');
  assert(result1.includes('テスト太郎'));
  
  // 同じスケジュールIDの場合
  const result2 = describeDuplicateMatch(match1, 'event-1', 'schedule-1');
  assert(result2.includes('同日程'));
  
  // match が null の場合
  assert.equal(describeDuplicateMatch(null, 'event-1', 'schedule-1'), '');
  
  // 名前がない場合
  const match2 = { participantId: 'pid-2', scheduleId: 'schedule-1' };
  const result3 = describeDuplicateMatch(match2, 'event-1', 'schedule-2');
  assert(typeof result3 === 'string');
  assert(result3.length > 0);
});
