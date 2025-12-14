import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ASSIGNMENT_VALUE_ABSENT,
  ASSIGNMENT_VALUE_STAFF,
  ASSIGNMENT_VALUE_UNAVAILABLE,
  MAX_TEAM_COUNT,
  ASSIGNMENT_BUCKET_UNASSIGNED,
  ASSIGNMENT_BUCKET_ABSENT,
  ASSIGNMENT_BUCKET_STAFF,
  ASSIGNMENT_BUCKET_UNAVAILABLE,
  SCHEDULE_RESPONSE_POSITIVE_KEYWORDS,
  SCHEDULE_RESPONSE_NEGATIVE_KEYWORDS,
  SCHEDULE_RESPONSE_STAFF_KEYWORDS,
  INTERNAL_ROLE_OPTIONS,
  INTERNAL_GRADE_OPTIONS,
  INTERNAL_CUSTOM_OPTION_VALUE,
  toDateTimeLocalString,
  toTimestamp,
  parseTeamCount,
  buildSequentialTeams,
  deriveTeamCountFromConfig,
  sanitizeTeamList,
  normalizeScheduleTeamConfig,
  getScheduleTeams,
  buildScheduleBuckets,
  determineGradeBadgeVariant,
  getGradeSortWeight,
  formatAssignmentLabelForPrint,
  resolveScheduleResponseValue,
  formatScheduleResponseText,
  determineScheduleResponseVariant,
  buildRenderableSchedules,
  isApplicantAvailableForSchedule,
  normalizeScheduleConfig,
  sanitizeScheduleEntries,
  buildScheduleConfigMap,
  scheduleSummaryMapsEqual,
  createSignature,
  normalizeAssignmentEntry,
  normalizeAssignmentSnapshot,
  normalizeApplications,
  formatTeamOptionLabel,
  buildAssignmentOptions,
  buildInternalAssignmentOptions,
  buildAssignmentOptionsForApplication,
  resolveAssignmentValue,
  resolveEffectiveAssignmentValue,
  resolveAssignmentStatus,
  formatAssignmentTimestamp,
  formatAssignmentUpdatedLabel,
  buildAcademicPathText
} from '../scripts/events/panels/gl-utils.js';

test('ASSIGNMENT_VALUE constants are defined', () => {
  assert.equal(ASSIGNMENT_VALUE_ABSENT, '__absent');
  assert.equal(ASSIGNMENT_VALUE_STAFF, '__staff');
  assert.equal(ASSIGNMENT_VALUE_UNAVAILABLE, '__unavailable');
  assert.equal(MAX_TEAM_COUNT, 50);
});

test('ASSIGNMENT_BUCKET constants are defined', () => {
  assert.equal(ASSIGNMENT_BUCKET_UNASSIGNED, '__unassigned');
  assert.equal(ASSIGNMENT_BUCKET_ABSENT, '__bucket_absent');
  assert.equal(ASSIGNMENT_BUCKET_STAFF, '__bucket_staff');
  assert.equal(ASSIGNMENT_BUCKET_UNAVAILABLE, '__bucket_unavailable');
});

test('SCHEDULE_RESPONSE constants are defined', () => {
  assert(Array.isArray(SCHEDULE_RESPONSE_POSITIVE_KEYWORDS));
  assert(SCHEDULE_RESPONSE_POSITIVE_KEYWORDS.includes('yes'));
  assert(SCHEDULE_RESPONSE_POSITIVE_KEYWORDS.includes('参加'));
  
  assert(Array.isArray(SCHEDULE_RESPONSE_NEGATIVE_KEYWORDS));
  assert(SCHEDULE_RESPONSE_NEGATIVE_KEYWORDS.includes('no'));
  assert(SCHEDULE_RESPONSE_NEGATIVE_KEYWORDS.includes('不可'));
  
  assert(Array.isArray(SCHEDULE_RESPONSE_STAFF_KEYWORDS));
  assert(SCHEDULE_RESPONSE_STAFF_KEYWORDS.includes('staff'));
  assert(SCHEDULE_RESPONSE_STAFF_KEYWORDS.includes('運営'));
});

test('INTERNAL constants are defined', () => {
  assert(Array.isArray(INTERNAL_ROLE_OPTIONS));
  assert(INTERNAL_ROLE_OPTIONS.includes('司会'));
  assert(INTERNAL_ROLE_OPTIONS.includes('GL'));
  
  assert(Array.isArray(INTERNAL_GRADE_OPTIONS));
  assert(INTERNAL_GRADE_OPTIONS.includes('1年'));
  assert(INTERNAL_GRADE_OPTIONS.includes('修士1年'));
  
  assert.equal(INTERNAL_CUSTOM_OPTION_VALUE, '__custom');
});

test('toDateTimeLocalString converts timestamp to datetime-local string', () => {
  const date = new Date(2025, 4, 10, 14, 30);
  const timestamp = date.getTime();
  const result = toDateTimeLocalString(timestamp);
  assert.equal(result, '2025-05-10T14:30');
});

test('toDateTimeLocalString handles invalid input', () => {
  assert.equal(toDateTimeLocalString(null), '');
  assert.equal(toDateTimeLocalString(undefined), '');
  assert.equal(toDateTimeLocalString('invalid'), '');
  assert.equal(toDateTimeLocalString(0), '');
});

test('toTimestamp converts value to ISO string', () => {
  const date = new Date(2025, 4, 10, 14, 30);
  const timestamp = date.getTime();
  const result = toTimestamp(timestamp);
  assert(result.includes('2025-05-10'));
});

test('toTimestamp handles invalid input', () => {
  assert.equal(toTimestamp(null), '');
  assert.equal(toTimestamp(undefined), '');
  assert.equal(toTimestamp('invalid'), '');
  assert.equal(toTimestamp(0), '');
});

test('parseTeamCount parses team count', () => {
  assert.deepEqual(parseTeamCount('10'), { count: 10, error: '' });
  assert.deepEqual(parseTeamCount('0'), { count: 0, error: '' });
  assert.deepEqual(parseTeamCount('50'), { count: 50, error: '' });
  assert.deepEqual(parseTeamCount('51'), { count: 0, error: '班は最大50班まで設定できます。' });
  assert.deepEqual(parseTeamCount('invalid'), { count: 0, error: '班の数は0以上の整数で入力してください。' });
  assert.deepEqual(parseTeamCount(''), { count: 0, error: '' });
});

test('buildSequentialTeams builds sequential team list', () => {
  assert.deepEqual(buildSequentialTeams(0), []);
  assert.deepEqual(buildSequentialTeams(1), ['1班']);
  assert.deepEqual(buildSequentialTeams(3), ['1班', '2班', '3班']);
  assert.equal(buildSequentialTeams(51).length, 50); // MAX_TEAM_COUNT で制限
});

test('deriveTeamCountFromConfig derives team count from config', () => {
  assert.equal(deriveTeamCountFromConfig(['1班', '2班', '3班']), 3);
  assert.equal(deriveTeamCountFromConfig([]), 0);
  assert.equal(deriveTeamCountFromConfig(null), 0);
  assert.equal(deriveTeamCountFromConfig(undefined), 0);
});

test('sanitizeTeamList sanitizes team list', () => {
  const result = sanitizeTeamList(['1班', '2班', '  3班  ']);
  assert(Array.isArray(result));
  assert(result.length > 0);
});

test('normalizeScheduleTeamConfig normalizes schedule team config', () => {
  // normalizeScheduleTeamConfig はオブジェクトを返す
  const result = normalizeScheduleTeamConfig({ 'schedule-1': { teams: ['1班', '2班'] } });
  assert(typeof result === 'object');
  assert.notEqual(result, null);
});

test('getScheduleTeams gets teams for schedule', () => {
  const config = {
    schedules: {
      'schedule-1': { teams: ['1班', '2班'] }
    }
  };
  const teams = getScheduleTeams(config, 'schedule-1');
  assert(Array.isArray(teams));
});

test('buildScheduleBuckets builds schedule buckets', () => {
  const teams = ['1班', '2班', '3班'];
  const buckets = buildScheduleBuckets(teams);
  assert(Array.isArray(buckets));
  assert(buckets.length > 0);
});

test('determineGradeBadgeVariant determines badge variant', () => {
  const variant = determineGradeBadgeVariant('1年');
  assert(typeof variant === 'string');
});

test('getGradeSortWeight gets sort weight for grade', () => {
  assert(typeof getGradeSortWeight('1年') === 'number');
  assert(typeof getGradeSortWeight('その他') === 'number');
});

test('formatAssignmentLabelForPrint formats assignment label', () => {
  assert.equal(formatAssignmentLabelForPrint(ASSIGNMENT_VALUE_ABSENT), '欠席');
  assert.equal(formatAssignmentLabelForPrint(ASSIGNMENT_VALUE_STAFF), '運営待機');
  assert.equal(formatAssignmentLabelForPrint(ASSIGNMENT_VALUE_UNAVAILABLE), '参加不可');
  assert.equal(formatAssignmentLabelForPrint('1班'), '1');
  assert.equal(formatAssignmentLabelForPrint('班: 2'), '2');
});

test('resolveScheduleResponseValue resolves schedule response value', () => {
  const application = {
    shifts: {
      'schedule-1': 'yes'
    }
  };
  const result = resolveScheduleResponseValue(application, 'schedule-1');
  // resolveScheduleResponseValue は { raw, text } オブジェクトを返す
  assert(typeof result === 'object');
  assert.notEqual(result, null);
  assert('raw' in result);
  assert('text' in result);
});

test('formatScheduleResponseText formats schedule response text', () => {
  const text = formatScheduleResponseText(ASSIGNMENT_VALUE_STAFF);
  assert(typeof text === 'string');
});

test('determineScheduleResponseVariant determines response variant', () => {
  const variant = determineScheduleResponseVariant('yes', '参加可');
  assert(typeof variant === 'string');
});

test('buildRenderableSchedules builds renderable schedule list', () => {
  const primary = [{ id: 'schedule-1', label: '昼の部' }];
  const result = buildRenderableSchedules(primary, [], []);
  assert(Array.isArray(result));
  assert(result.length > 0);
  assert.equal(result[0].id, 'schedule-1');
});

test('buildRenderableSchedules falls back to default when empty', () => {
  const result = buildRenderableSchedules([], [], []);
  assert(Array.isArray(result));
  assert(result.length > 0);
  assert(result[0].id === '__default__');
});

test('isApplicantAvailableForSchedule checks availability', () => {
  const application = {
    shifts: {
      'schedule-1': true
    }
  };
  assert.equal(isApplicantAvailableForSchedule(application, 'schedule-1'), true);
  assert.equal(isApplicantAvailableForSchedule(application, 'schedule-2'), false);
  assert.equal(isApplicantAvailableForSchedule(null, 'schedule-1'), false);
});

test('normalizeScheduleConfig normalizes schedule config', () => {
  const result1 = normalizeScheduleConfig([{ id: 'schedule-1', label: '昼の部' }]);
  assert(Array.isArray(result1));
  
  const result2 = normalizeScheduleConfig({ 'schedule-1': { id: 'schedule-1', label: '昼の部' } });
  assert(Array.isArray(result2));
  
  assert.deepEqual(normalizeScheduleConfig(null), []);
  assert.deepEqual(normalizeScheduleConfig(undefined), []);
});

test('sanitizeScheduleEntries sanitizes schedule entries', () => {
  const schedules = [
    { id: 'schedule-1', label: '昼の部' },
    { id: '', label: '無効' },
    { id: 'schedule-2', date: '2025-05-10' }
  ];
  const result = sanitizeScheduleEntries(schedules);
  assert(Array.isArray(result));
  assert.equal(result.length, 2); // 空の id は除外される
});

test('buildScheduleConfigMap builds schedule config map', () => {
  const schedules = [{ id: 'schedule-1', label: '昼の部' }];
  const result = buildScheduleConfigMap(schedules);
  assert(typeof result === 'object');
  assert('schedule-1' in result);
});

test('scheduleSummaryMapsEqual compares schedule summary maps', () => {
  const first = {
    'schedule-1': { id: 'schedule-1', label: '昼の部', date: '2025-05-10' }
  };
  const second = {
    'schedule-1': { id: 'schedule-1', label: '昼の部', date: '2025-05-10' }
  };
  assert.equal(scheduleSummaryMapsEqual(first, second), true);
  assert.equal(scheduleSummaryMapsEqual(first, {}), false);
});

test('createSignature creates signature from list', () => {
  const list = ['a', 'b', 'c'];
  const signature = createSignature(list);
  assert(typeof signature === 'string');
  assert(signature.includes('a'));
});

test('normalizeAssignmentEntry normalizes assignment entry', () => {
  const entry = normalizeAssignmentEntry({
    status: 'team',
    teamId: '1班',
    updatedAt: 1234567890
  });
  assert.notEqual(entry, null);
  assert.equal(entry.status, 'team');
  assert.equal(entry.teamId, '1班');
  assert.equal(entry.updatedAt, 1234567890);
  
  assert.equal(normalizeAssignmentEntry(null), null);
  assert.equal(normalizeAssignmentEntry({}), null);
});

test('normalizeAssignmentSnapshot normalizes assignment snapshot', () => {
  const snapshot = {
    'gl-1': {
      status: 'team',
      teamId: '1班',
      schedules: {
        'schedule-1': { status: 'team', teamId: '2班' }
      }
    }
  };
  const result = normalizeAssignmentSnapshot(snapshot);
  assert(result instanceof Map);
});

test('normalizeApplications normalizes applications', () => {
  const snapshot = {
    'app-1': {
      name: '申請者1',
      shifts: { 'schedule-1': true },
      createdAt: 1234567890
    }
  };
  const result = normalizeApplications(snapshot);
  assert(Array.isArray(result));
  assert(result.length > 0);
  assert.equal(result[0].name, '申請者1');
});

test('formatTeamOptionLabel formats team option label', () => {
  assert.equal(formatTeamOptionLabel('1班'), '1');
  assert.equal(formatTeamOptionLabel('班: 2'), '2');
  assert.equal(formatTeamOptionLabel('123'), '123');
  assert.equal(formatTeamOptionLabel('custom'), '班: custom');
});

test('buildAssignmentOptions builds assignment options', () => {
  const teams = ['1班', '2班'];
  const options = buildAssignmentOptions(teams);
  assert(Array.isArray(options));
  assert(options.length > 0);
  assert(options.some(opt => opt.value === ''));
  assert(options.some(opt => opt.value === '1班'));
});

test('buildInternalAssignmentOptions builds internal assignment options', () => {
  const teams = ['1班'];
  const options = buildInternalAssignmentOptions(teams, '司会');
  assert(Array.isArray(options));
  assert(options.some(opt => opt.value === '司会'));
});

test('buildAssignmentOptionsForApplication builds options for application', () => {
  const teams = ['1班'];
  const internalApp = { sourceType: 'internal', role: '司会' };
  const externalApp = { sourceType: 'external' };
  
  const options1 = buildAssignmentOptionsForApplication(internalApp, teams);
  assert(Array.isArray(options1));
  
  const options2 = buildAssignmentOptionsForApplication(externalApp, teams);
  assert(Array.isArray(options2));
});

test('resolveAssignmentValue resolves assignment value', () => {
  assert.equal(resolveAssignmentValue({ status: 'absent' }), ASSIGNMENT_VALUE_ABSENT);
  assert.equal(resolveAssignmentValue({ status: 'staff' }), ASSIGNMENT_VALUE_STAFF);
  assert.equal(resolveAssignmentValue({ status: 'team', teamId: '1班' }), '1班');
  assert.equal(resolveAssignmentValue({ teamId: '1班' }), '1班');
  assert.equal(resolveAssignmentValue(null), '');
});

test('resolveEffectiveAssignmentValue resolves effective assignment value', () => {
  const internalApp = { sourceType: 'internal', role: '司会' };
  const externalApp = { sourceType: 'external' };
  
  assert.equal(resolveEffectiveAssignmentValue(internalApp, {}), '司会');
  assert.equal(resolveEffectiveAssignmentValue(externalApp, {}), '');
  assert.equal(resolveEffectiveAssignmentValue(internalApp, { status: 'team', teamId: '1班' }), '1班');
});

test('resolveAssignmentStatus resolves assignment status', () => {
  assert.deepEqual(resolveAssignmentStatus(ASSIGNMENT_VALUE_UNAVAILABLE), { status: 'unavailable', teamId: '' });
  assert.deepEqual(resolveAssignmentStatus(ASSIGNMENT_VALUE_ABSENT), { status: 'absent', teamId: '' });
  assert.deepEqual(resolveAssignmentStatus(ASSIGNMENT_VALUE_STAFF), { status: 'staff', teamId: '' });
  assert.deepEqual(resolveAssignmentStatus('1班'), { status: 'team', teamId: '1班' });
  assert.deepEqual(resolveAssignmentStatus(''), { status: '', teamId: '' });
});

test('formatAssignmentTimestamp formats assignment timestamp', () => {
  const assignment = { updatedAt: Date.now() };
  const result = formatAssignmentTimestamp(assignment);
  assert(typeof result === 'string');
  assert(result.length > 0);
  
  assert.equal(formatAssignmentTimestamp(null), '');
  assert.equal(formatAssignmentTimestamp({}), '');
});

test('formatAssignmentUpdatedLabel formats assignment updated label', () => {
  const assignment = {
    updatedAt: Date.now(),
    updatedByName: 'オペレーター'
  };
  const result = formatAssignmentUpdatedLabel(assignment);
  assert(typeof result === 'string');
  assert(result.includes('更新:'));
  assert(result.includes('オペレーター'));
});

test('buildAcademicPathText builds academic path text', () => {
  const application = {
    faculty: '工学部',
    academicPath: ['情報学科', 'コンピュータ科学コース']
  };
  const result = buildAcademicPathText(application);
  assert.equal(result, '工学部 / 情報学科 / コンピュータ科学コース');
  
  assert.equal(buildAcademicPathText(null), '');
  assert.equal(buildAcademicPathText({}), '');
});
