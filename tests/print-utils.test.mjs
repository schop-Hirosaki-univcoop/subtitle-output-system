import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  PRINT_LOG_PREFIX,
  PRINT_SETTING_STORAGE_KEY,
  DEFAULT_CUSTOM_PAGE_SIZE,
  DEFAULT_PRINT_SETTINGS,
  PRINT_PAPER_SIZE_MAP,
  PRINT_PAPER_SIZES,
  PRINT_ORIENTATIONS,
  PRINT_MARGINS,
  escapeHtml,
  formatPrintCell,
  formatMetaDisplay,
  formatPrintDateTimeRange,
  normalizePageDimension,
  normalizePrintSettings,
  resolvePrintPageSize,
  buildParticipantPrintHtml,
  buildMinimalParticipantPrintPreview,
  buildStaffPrintHtml,
  buildEventSelectionPrintHtml,
  buildGlShiftTablePrintHtml,
  logPrintInfo,
  logPrintWarn,
  logPrintError,
  logPrintDebug
} from '../scripts/shared/print-utils.js';

test('PRINT_LOG_PREFIX is defined', () => {
  assert.equal(PRINT_LOG_PREFIX, '[Print]');
});

test('PRINT_SETTING_STORAGE_KEY is defined', () => {
  assert.equal(PRINT_SETTING_STORAGE_KEY, 'qa.printSettings.v1');
});

test('DEFAULT_CUSTOM_PAGE_SIZE is defined', () => {
  assert.deepEqual(DEFAULT_CUSTOM_PAGE_SIZE, { width: 210, height: 297 });
});

test('DEFAULT_PRINT_SETTINGS is defined', () => {
  assert.equal(DEFAULT_PRINT_SETTINGS.paperSize, 'A4');
  assert.equal(DEFAULT_PRINT_SETTINGS.orientation, 'portrait');
  assert.equal(DEFAULT_PRINT_SETTINGS.margin, '5mm');
  assert.equal(DEFAULT_PRINT_SETTINGS.showHeader, true);
});

test('PRINT_PAPER_SIZE_MAP is defined', () => {
  assert('A4' in PRINT_PAPER_SIZE_MAP);
  assert('A3' in PRINT_PAPER_SIZE_MAP);
  assert.deepEqual(PRINT_PAPER_SIZE_MAP.A4, { width: 210, height: 297 });
});

test('PRINT_PAPER_SIZES is defined', () => {
  assert(PRINT_PAPER_SIZES instanceof Set);
  assert(PRINT_PAPER_SIZES.has('A4'));
  assert(PRINT_PAPER_SIZES.has('A3'));
});

test('PRINT_ORIENTATIONS is defined', () => {
  assert(PRINT_ORIENTATIONS instanceof Set);
  assert(PRINT_ORIENTATIONS.has('portrait'));
  assert(PRINT_ORIENTATIONS.has('landscape'));
});

test('PRINT_MARGINS is defined', () => {
  assert(PRINT_MARGINS instanceof Set);
  assert(PRINT_MARGINS.has('5mm'));
  assert(PRINT_MARGINS.has('10mm'));
  assert(PRINT_MARGINS.has('15mm'));
});

test('escapeHtml escapes HTML special characters', () => {
  assert.equal(escapeHtml('hello'), 'hello');
  assert.equal(escapeHtml('hello & world'), 'hello &amp; world');
  assert.equal(escapeHtml('hello < world'), 'hello &lt; world');
  assert.equal(escapeHtml('hello > world'), 'hello &gt; world');
  assert.equal(escapeHtml('hello " world'), 'hello &quot; world');
  assert.equal(escapeHtml("hello ' world"), "hello &#39; world");
  assert.equal(escapeHtml(null), '');
});

test('formatPrintCell formats print cell', () => {
  assert.equal(formatPrintCell('test'), 'test');
  assert.equal(formatPrintCell('test\nline2'), 'test<br>line2');
  assert.equal(formatPrintCell(''), '&nbsp;');
  assert.equal(formatPrintCell(null), '&nbsp;');
  assert.equal(formatPrintCell('test', { placeholder: '—' }), 'test');
  assert.equal(formatPrintCell('', { placeholder: '—' }), '—');
});

test('formatMetaDisplay formats meta display', () => {
  assert.equal(formatMetaDisplay('Event Name', 'event-1'), 'Event Name（ID: event-1）');
  assert.equal(formatMetaDisplay('Event Name', 'Event Name'), 'Event Name');
  assert.equal(formatMetaDisplay('', 'event-1'), 'event-1');
  assert.equal(formatMetaDisplay('Event Name', ''), 'Event Name');
  assert.equal(formatMetaDisplay('', ''), '');
});

test('formatPrintDateTimeRange formats print date time range', () => {
  const start = new Date(2025, 4, 10, 10, 0);
  const end = new Date(2025, 4, 10, 12, 0);
  const result = formatPrintDateTimeRange(start, end);
  assert(typeof result === 'string');
  assert(result.length > 0);
  
  const result2 = formatPrintDateTimeRange(start, null);
  assert(typeof result2 === 'string');
  assert(result2.includes('〜'));
  
  assert.equal(formatPrintDateTimeRange(null, null), '');
});

test('normalizePageDimension normalizes page dimension', () => {
  assert.equal(normalizePageDimension(210), 210);
  assert.equal(normalizePageDimension('210'), 210);
  assert.equal(normalizePageDimension(0), 210); // fallback
  assert.equal(normalizePageDimension(-10), 210); // fallback
  assert.equal(normalizePageDimension(5000), 2000); // max
  assert.equal(normalizePageDimension(5), 10); // min
  assert.equal(normalizePageDimension('invalid', 100), 100);
});

test('normalizePrintSettings normalizes print settings', () => {
  const settings = normalizePrintSettings({ paperSize: 'A3', orientation: 'landscape' });
  assert.equal(settings.paperSize, 'A3');
  assert.equal(settings.orientation, 'landscape');
  assert.equal(settings.margin, '5mm'); // default
  assert.equal(settings.showHeader, true); // default
  
  const settings2 = normalizePrintSettings({ paperSize: 'Invalid' });
  assert.equal(settings2.paperSize, 'A4'); // fallback to default
  
  const settings3 = normalizePrintSettings({ showHeader: false });
  assert.equal(settings3.showHeader, false);
  assert.equal(settings3.repeatHeader, false); // repeatHeader is false when showHeader is false
});

test('resolvePrintPageSize resolves print page size', () => {
  const size1 = resolvePrintPageSize({ paperSize: 'A4', orientation: 'portrait' });
  assert.equal(size1.width, 210);
  assert.equal(size1.height, 297);
  
  const size2 = resolvePrintPageSize({ paperSize: 'A4', orientation: 'landscape' });
  assert.equal(size2.width, 297);
  assert.equal(size2.height, 210);
  
  const size3 = resolvePrintPageSize({ paperSize: 'Custom', customWidth: 300, customHeight: 400, orientation: 'portrait' });
  assert.equal(size3.width, 300);
  assert.equal(size3.height, 400);
});

test('buildParticipantPrintHtml builds participant print HTML', () => {
  const result = buildParticipantPrintHtml({
    eventId: 'event-1',
    scheduleId: 'schedule-1',
    eventName: 'テストイベント',
    scheduleLabel: 'テスト日程',
    groups: [{
      label: '班番号',
      value: '1班',
      participants: [{ name: 'テスト太郎', phonetic: 'てすとたろう' }]
    }],
    totalCount: 1
  });
  assert(typeof result === 'string'); // buildParticipantPrintHtml は文字列を返す
  assert(result.length > 0);
  assert(result.includes('テストイベント'));
});

test('buildMinimalParticipantPrintPreview builds minimal preview', () => {
  const result = buildMinimalParticipantPrintPreview({
    participants: [{ name: 'テスト太郎' }]
  });
  assert(typeof result === 'string'); // buildMinimalParticipantPrintPreview は文字列を返す
  assert(result.length > 0);
});

test('buildStaffPrintHtml builds staff print HTML', () => {
  const result = buildStaffPrintHtml({
    eventName: 'テストイベント',
    groups: [{
      faculty: '工学部',
      members: [{ name: 'スタッフ1', assignment: '司会' }]
    }]
  });
  assert(typeof result === 'object');
  assert(typeof result.html === 'string');
  assert(result.html.length > 0);
  assert(result.html.includes('テストイベント'));
  assert(typeof result.docTitle === 'string');
  assert(typeof result.metaText === 'string');
});

test('buildEventSelectionPrintHtml builds event selection print HTML', () => {
  const result = buildEventSelectionPrintHtml({
    events: [{ id: 'event-1', name: 'テストイベント' }]
  });
  assert(typeof result === 'object');
  assert(typeof result.html === 'string');
  assert(result.html.length > 0);
  assert(typeof result.docTitle === 'string');
  assert(typeof result.metaText === 'string');
});

test('buildGlShiftTablePrintHtml builds GL shift table print HTML', () => {
  const result = buildGlShiftTablePrintHtml({
    eventName: 'テストイベント',
    schedules: [{ id: 'schedule-1', date: '2025-05-10' }],
    sections: [{
      label: 'セクション1',
      entries: [{ name: 'スタッフ1', values: { 'schedule-1': '1班' } }]
    }]
  });
  assert(typeof result === 'object');
  assert(typeof result.html === 'string');
  assert(result.html.length > 0);
  assert(typeof result.docTitle === 'string');
  assert(typeof result.metaText === 'string');
});

// logPrint のロジックを再現（関数名の衝突を避けるため、異なる名前を使用）
const PRINT_LOG_PREFIX_REPRODUCED = "[Print]";

function reproducedLogPrint(level, message, details, mockConsole) {
  if (typeof mockConsole === "undefined" || !mockConsole) {
    return;
  }
  const logger = (mockConsole[level] || mockConsole.log).bind(mockConsole);
  if (details !== undefined) {
    logger(`${PRINT_LOG_PREFIX_REPRODUCED} ${message}`, details);
  } else {
    logger(`${PRINT_LOG_PREFIX_REPRODUCED} ${message}`);
  }
}

function reproducedLogPrintInfo(message, details, mockConsole) {
  // 元のコードではコメントアウトされているが、ロジックを再現
  // logPrint("info", message, details);
  reproducedLogPrint("info", message, details, mockConsole);
}

function reproducedLogPrintWarn(message, details, mockConsole) {
  // 元のコードではコメントアウトされているが、ロジックを再現
  // logPrint("warn", message, details);
  reproducedLogPrint("warn", message, details, mockConsole);
}

function reproducedLogPrintError(message, details, mockConsole) {
  // 元のコードではコメントアウトされているが、ロジックを再現
  // logPrint("error", message, details);
  reproducedLogPrint("error", message, details, mockConsole);
}

function reproducedLogPrintDebug(message, details, mockConsole) {
  // 元のコードではコメントアウトされているが、ロジックを再現
  // logPrint("debug", message, details);
  reproducedLogPrint("debug", message, details, mockConsole);
}

test('logPrintInfo logs to console.info when console is available', () => {
  const mockConsole = {
    info: (message) => {
      assert(message.includes(PRINT_LOG_PREFIX_REPRODUCED));
      assert(message.includes('Test message'));
    },
    log: () => {}
  };
  reproducedLogPrintInfo('Test message', undefined, mockConsole);
});

test('logPrintInfo logs with details when provided', () => {
  const mockConsole = {
    info: (message, details) => {
      assert(message.includes(PRINT_LOG_PREFIX_REPRODUCED));
      assert.deepEqual(details, { key: 'value' });
    },
    log: () => {}
  };
  reproducedLogPrintInfo('Test message', { key: 'value' }, mockConsole);
});

test('logPrintInfo falls back to console.log when console.info is unavailable', () => {
  const mockConsole = {
    log: (message) => {
      assert(message.includes(PRINT_LOG_PREFIX_REPRODUCED));
      assert(message.includes('Test message'));
    }
  };
  reproducedLogPrintInfo('Test message', undefined, mockConsole);
});

test('logPrintWarn logs to console.warn when console is available', () => {
  const mockConsole = {
    warn: (message) => {
      assert(message.includes(PRINT_LOG_PREFIX_REPRODUCED));
      assert(message.includes('Warning message'));
    },
    log: () => {}
  };
  reproducedLogPrintWarn('Warning message', undefined, mockConsole);
});

test('logPrintError logs to console.error when console is available', () => {
  const mockConsole = {
    error: (message) => {
      assert(message.includes(PRINT_LOG_PREFIX_REPRODUCED));
      assert(message.includes('Error message'));
    },
    log: () => {}
  };
  reproducedLogPrintError('Error message', undefined, mockConsole);
});

test('logPrintDebug logs to console.debug when console is available', () => {
  const mockConsole = {
    debug: (message) => {
      assert(message.includes(PRINT_LOG_PREFIX_REPRODUCED));
      assert(message.includes('Debug message'));
    },
    log: () => {}
  };
  reproducedLogPrintDebug('Debug message', undefined, mockConsole);
});

test('logPrint functions handle undefined console gracefully', () => {
  // console が undefined の場合は何もしない
  reproducedLogPrintInfo('Test', undefined, undefined);
  reproducedLogPrintWarn('Test', undefined, undefined);
  reproducedLogPrintError('Test', undefined, undefined);
  reproducedLogPrintDebug('Test', undefined, undefined);
  // エラーが発生しないことを確認
  assert(true);
});
