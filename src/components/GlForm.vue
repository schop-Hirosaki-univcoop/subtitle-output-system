<template>
  <IntakeFormLayout
    title="GL応募フォーム"
    description="運営から案内されたURLからアクセスし、必要事項をご入力ください。"
    title-id="gl-form-title"
    description-id="gl-form-description"
  >
    <!-- コンテキストバナー -->
    <div v-if="contextBannerVisible" id="gl-context-banner" class="context-banner">
      <p v-if="eventName" id="gl-context-event" class="context-text">対象イベント: {{ eventName }}</p>
      <p v-if="periodText" id="gl-context-period" class="context-text">募集期間: {{ periodText }}</p>
    </div>

    <!-- 利用制限表示 -->
    <ContextGuard :message="contextGuardMessage" id="gl-context-guard" />

      <!-- GL応募フォーム -->
      <form v-if="!formLocked" id="gl-entry-form" class="intake-form" novalidate @submit.prevent="handleSubmit">
        <input id="gl-event-id" name="event-id" type="hidden" :value="eventId" />
        <input id="gl-slug" name="form-slug" type="hidden" :value="slug" />

        <!-- 氏名 -->
        <div class="form-field">
          <div class="field-header">
            <label for="gl-name">氏名</label>
            <span class="field-tag field-tag--required">必須</span>
          </div>
          <input
            id="gl-name"
            v-model="name"
            name="name"
            class="input"
            type="text"
            autocomplete="name"
            required
            :aria-invalid="fieldErrors.name ? 'true' : undefined"
            :aria-describedby="fieldErrors.name ? 'gl-name-error' : undefined"
            @blur="validateField('name')"
            @input="clearFieldError('name')"
          />
          <div v-if="fieldErrors.name" id="gl-name-error" class="form-error" role="alert">
            {{ fieldErrors.name }}
          </div>
        </div>

        <!-- フリガナ -->
        <div class="form-field">
          <div class="field-header">
            <label for="gl-phonetic">フリガナ</label>
          </div>
          <input id="gl-phonetic" v-model="phonetic" name="phonetic" class="input" type="text" autocomplete="off" />
        </div>

        <!-- メールアドレス -->
        <div class="form-field">
          <div class="field-header">
            <label for="gl-email">メールアドレス</label>
            <span class="field-tag field-tag--required">必須</span>
          </div>
          <input
            id="gl-email"
            v-model="email"
            name="email"
            class="input"
            type="email"
            autocomplete="email"
            required
            :aria-invalid="fieldErrors.email ? 'true' : undefined"
            :aria-describedby="fieldErrors.email ? 'gl-email-error' : undefined"
            @blur="validateField('email')"
            @input="clearFieldError('email')"
          />
          <div v-if="fieldErrors.email" id="gl-email-error" class="form-error" role="alert">
            {{ fieldErrors.email }}
          </div>
        </div>

        <!-- 学年 -->
        <div class="form-field">
          <div class="field-header">
            <label for="gl-grade">学年</label>
          </div>
          <select id="gl-grade" v-model="grade" name="grade" class="input">
            <option value="" data-placeholder="true" disabled>学年を選択してください</option>
            <option value="1年">1年</option>
            <option value="2年">2年</option>
            <option value="3年">3年</option>
            <option value="4年">4年</option>
            <option value="修士1年">修士1年</option>
            <option value="修士2年">修士2年</option>
            <option value="博士1年">博士1年</option>
            <option value="博士2年">博士2年</option>
            <option value="博士3年">博士3年</option>
            <option value="その他（備考欄に記入してください）">その他（備考欄に記入してください）</option>
          </select>
        </div>

        <!-- 性別 -->
        <div class="form-field">
          <div class="field-header">
            <label for="gl-gender">性別</label>
          </div>
          <select id="gl-gender" v-model="gender" name="gender" class="input">
            <option value="" data-placeholder="true" disabled>性別を選択してください</option>
            <option value="男性">男性</option>
            <option value="女性">女性</option>
            <option value="その他">その他</option>
            <option value="回答しない">回答しない</option>
          </select>
        </div>

        <!-- 学部 -->
        <div class="form-field">
          <div class="field-header">
            <label for="gl-faculty">学部</label>
            <span class="field-tag field-tag--required">必須</span>
          </div>
          <select
            id="gl-faculty"
            v-model="faculty"
            name="faculty"
            class="input"
            required
            :aria-invalid="fieldErrors.faculty ? 'true' : undefined"
            :aria-describedby="fieldErrors.faculty ? 'gl-faculty-error' : undefined"
            @change="handleFacultyChange"
            @blur="validateField('faculty')"
          >
            <option value="" data-placeholder="true" disabled>学部を選択してください</option>
            <option v-for="facultyOption in facultyOptions" :key="facultyOption.faculty" :value="facultyOption.faculty">
              {{ facultyOption.faculty }}
            </option>
            <option :value="CUSTOM_OPTION_VALUE">その他</option>
          </select>
          <div v-if="fieldErrors.faculty" id="gl-faculty-error" class="form-error" role="alert">
            {{ fieldErrors.faculty }}
          </div>
        </div>

        <!-- 学歴フィールド（動的生成） -->
        <div id="gl-academic-fields">
          <div
            v-for="(level, depth) in academicLevels"
            :key="`academic-${depth}`"
            class="form-field gl-academic-field"
            :data-depth="depth"
          >
            <div class="field-header">
              <label :for="`gl-academic-select-${depth}`" class="gl-academic-label">{{ level.label }}</label>
              <span class="field-tag field-tag--required">必須</span>
            </div>
            <select
              :id="`gl-academic-select-${depth}`"
              v-model="academicSelections[depth]"
              class="input gl-academic-select"
              :data-depth="depth"
              :data-level-label="level.label"
              required
              :aria-invalid="fieldErrors[`academic-${depth}`] ? 'true' : undefined"
              :aria-describedby="fieldErrors[`academic-${depth}`] ? `gl-academic-select-${depth}-error` : undefined"
              @change="handleAcademicLevelChange(depth)"
              @blur="validateAcademicField(depth)"
            >
              <option value="" data-placeholder="true" disabled>{{ level.placeholder || `${level.label}を選択してください` }}</option>
              <option v-for="(option, index) in level.options" :key="index" :value="option.value" :data-option-index="index" :data-has-children="option.children ? 'true' : undefined">
                {{ option.label }}
              </option>
              <option v-if="level.allowCustom !== false" :value="CUSTOM_OPTION_VALUE" data-is-custom="true">その他</option>
            </select>
            <div v-if="fieldErrors[`academic-${depth}`]" :id="`gl-academic-select-${depth}-error`" class="form-error" role="alert">
              {{ fieldErrors[`academic-${depth}`] }}
            </div>
          </div>
        </div>

        <!-- カスタム学歴フィールド -->
        <div v-if="academicCustomVisible" class="form-field" id="gl-academic-custom-field">
          <div class="field-header">
            <label for="gl-academic-custom" id="gl-academic-custom-label">{{ academicCustomLabel }}（その他入力）</label>
          </div>
          <input
            id="gl-academic-custom"
            v-model="academicCustomValue"
            name="academic-custom"
            class="input"
            type="text"
            autocomplete="off"
            :placeholder="`${academicCustomLabel}名を入力してください`"
            :required="academicCustomVisible"
            :aria-invalid="fieldErrors['academic-custom'] ? 'true' : undefined"
            :aria-describedby="fieldErrors['academic-custom'] ? 'gl-academic-custom-error' : undefined"
            @blur="validateField('academic-custom')"
            @input="clearFieldError('academic-custom')"
          />
          <div v-if="fieldErrors['academic-custom']" id="gl-academic-custom-error" class="form-error" role="alert">
            {{ fieldErrors['academic-custom'] }}
          </div>
        </div>

        <!-- 学籍番号 -->
        <div class="form-field">
          <div class="field-header">
            <label for="gl-student-id">学籍番号</label>
          </div>
          <input id="gl-student-id" v-model="studentId" name="student-id" class="input" type="text" autocomplete="off" />
        </div>

        <!-- 所属している部活・サークル -->
        <div class="form-field">
          <div class="field-header">
            <label for="gl-club">所属している部活・サークル</label>
          </div>
          <input id="gl-club" v-model="club" name="club" class="input" type="text" autocomplete="off" />
        </div>

        <!-- 参加可能な日程 -->
        <fieldset v-if="schedules.length > 0" id="gl-shift-fieldset" class="form-field" aria-describedby="gl-shift-hint">
          <legend class="field-header">参加可能な日程（複数選択可）</legend>
          <p id="gl-shift-hint" class="field-hint">参加できる日程にチェックを入れてください。日付と時間はすべての選択肢に表示されます。</p>
          <div id="gl-shift-list" class="gl-shift-checkboxes">
            <label v-for="schedule in availableSchedules" :key="schedule.id" class="gl-shift-option">
              <input
                v-model="selectedShifts"
                type="checkbox"
                :value="schedule.id"
                :name="`shift-${schedule.id}`"
                :data-schedule-id="schedule.id"
              />
              <span>{{ formatScheduleOption(schedule) }}</span>
            </label>
          </div>
          <div v-if="fieldErrors.shifts" id="gl-shift-error" class="form-error" role="alert">
            {{ fieldErrors.shifts }}
          </div>
        </fieldset>

        <!-- 備考・連絡事項 -->
        <div class="form-field">
          <div class="field-header">
            <label for="gl-note">備考・連絡事項</label>
            <span class="field-tag">任意</span>
          </div>
          <textarea id="gl-note" v-model="note" name="note" class="input input--textarea" rows="4" placeholder="連絡事項があればご記入ください"></textarea>
        </div>

        <!-- 個人情報の取扱いについて同意 -->
        <div class="form-field">
          <label class="checkbox-label" for="gl-privacy-consent">
            <input
              id="gl-privacy-consent"
              v-model="privacyConsent"
              name="privacy-consent"
              type="checkbox"
              required
              :aria-invalid="fieldErrors['privacy-consent'] ? 'true' : undefined"
              :aria-describedby="fieldErrors['privacy-consent'] ? 'gl-privacy-consent-error' : undefined"
              @change="clearFieldError('privacy-consent')"
            />
            <span>個人情報の取扱いについて同意します</span>
          </label>
          <div v-if="fieldErrors['privacy-consent']" id="gl-privacy-consent-error" class="form-error" role="alert">
            {{ fieldErrors['privacy-consent'] }}
          </div>
        </div>

        <!-- 送信ボタン -->
        <FormActions
          :is-busy="isSubmitting"
          :disabled="isSubmitting"
          :feedback-message="feedbackMessage"
          :feedback-type="feedbackType"
          button-id="gl-submit-button"
          feedback-id="gl-form-feedback"
        />
      </form>

      <!-- 利用案内 -->
      <div v-if="formMetaVisible" class="form-meta" id="gl-form-meta">
        <p class="form-meta-line">送信完了後、運営からの案内をお待ちください。</p>
        <p class="form-meta-line">入力内容に誤りがあった場合は、案内元までご連絡ください。</p>
      </div>
  </IntakeFormLayout>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { initializeApp, getApps, getApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getDatabase, ref as dbRef, get, push, set, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js';
import { FIREBASE_CONFIG } from '../../scripts/shared/firebase-config.js';
import {
  CUSTOM_OPTION_VALUE,
  ensureString,
  parseTimestamp,
  formatPeriod,
  parseFaculties,
  parseSchedules,
  formatScheduleOption,
  parseUnitLevel,
} from '../../scripts/gl-form/gl-form-utils.js';
import IntakeFormLayout from './IntakeFormLayout.vue';
import ContextGuard from './ContextGuard.vue';
import FormActions from './FormActions.vue';
import { useFormFeedback } from '../composables/useFormFeedback.js';
import { useFormGuard } from '../composables/useFormGuard.js';

// Firebase初期化
const apps = getApps();
const firebaseApp = apps.length ? getApp() : initializeApp(FIREBASE_CONFIG);
const database = getDatabase(firebaseApp);

// 定数
const GRADE_OPTIONS = ['1年', '2年', '3年', '4年', '修士1年', '修士2年', '博士1年', '博士2年', '博士3年', 'その他（備考欄に記入してください）'];
const GENDER_OPTIONS = ['男性', '女性', 'その他', '回答しない'];

// 状態管理
const slug = ref('');
const eventId = ref('');
const eventName = ref('');
const periodText = ref('');
const formLocked = ref(true);
const isSubmitting = ref(false);

// 共通Composables
const { feedbackMessage, feedbackType, setFeedback, clearFeedback } = useFormFeedback();
const { contextGuardMessage, setContextGuard, clearContextGuard } = useFormGuard({
  onLock: () => {
    formLocked.value = true;
  },
  onUnlock: () => {
    formLocked.value = false;
  },
  guardElementId: 'gl-context-guard',
});

// フォーム入力値
const name = ref('');
const phonetic = ref('');
const email = ref('');
const grade = ref('');
const gender = ref('');
const faculty = ref('');
const studentId = ref('');
const club = ref('');
const note = ref('');
const privacyConsent = ref(false);
const selectedShifts = ref([]);

// フィールドエラー（各フィールドの下に表示）
const fieldErrors = ref({});

// 学部・学歴データ
const facultyOptions = ref([]);
const academicLevels = ref([]);
const academicSelections = ref([]);
const academicCustomVisible = ref(false);
const academicCustomLabel = ref('所属');
const academicCustomValue = ref('');

// スケジュールデータ
const schedules = ref([]);

// 学歴レベルマップ（使用しないが、互換性のために保持）
// const unitLevelMap = new Map();

// 送信成功フラグ
const submissionSuccess = ref(false);

// Computed
const contextBannerVisible = computed(() => Boolean(eventName.value || periodText.value));
const formMetaVisible = computed(() => submissionSuccess.value);
const availableSchedules = computed(() => {
  return schedules.value
    .filter((schedule) => schedule.recruitGl !== false)
    .sort((a, b) => {
      const aTime = a.startAt || (a.date ? Date.parse(a.date) : 0) || 0;
      const bTime = b.startAt || (b.date ? Date.parse(b.date) : 0) || 0;
      return aTime - bTime;
    });
});

// メソッド（共通Composablesで管理されるため削除）

const setFieldError = (fieldName, message) => {
  fieldErrors.value[fieldName] = message;
};

const clearFieldError = (fieldName) => {
  if (fieldErrors.value[fieldName]) {
    delete fieldErrors.value[fieldName];
  }
};

const clearAllFieldErrors = () => {
  fieldErrors.value = {};
};

const validateField = (fieldName) => {
  clearFieldError(fieldName);
  const element = document.getElementById(`gl-${fieldName}`);
  if (!element) return;
  if (element instanceof HTMLInputElement || element instanceof HTMLSelectElement) {
    if (!element.checkValidity()) {
      let message = '';
      if (element.validity.valueMissing) {
        message = 'この項目は必須です。';
      } else if (element.validity.typeMismatch && element.type === 'email') {
        message = '正しいメールアドレスを入力してください。';
      } else {
        message = element.validationMessage || '入力内容に誤りがあります。';
      }
      setFieldError(fieldName, message);
    }
  }
};

const validateAcademicField = (depth) => {
  const fieldName = `academic-${depth}`;
  clearFieldError(fieldName);
  const element = document.getElementById(`gl-academic-select-${depth}`);
  if (!element || !(element instanceof HTMLSelectElement)) return;
  if (!element.checkValidity()) {
    const levelLabel = element.dataset?.levelLabel || '所属';
    if (element.validity.valueMissing) {
      setFieldError(fieldName, `${levelLabel}を選択してください。`);
    } else {
      setFieldError(fieldName, element.validationMessage || '選択内容に誤りがあります。');
    }
  }
};

const clearAcademicFields = () => {
  academicLevels.value = [];
  academicSelections.value = [];
  academicCustomVisible.value = false;
  academicCustomValue.value = '';
};

const removeAcademicFieldsAfter = (depth) => {
  academicLevels.value = academicLevels.value.slice(0, depth + 1);
  academicSelections.value = academicSelections.value.slice(0, depth + 1);
};

const updateAcademicCustomField = (label) => {
  if (label) {
    academicCustomLabel.value = label;
    academicCustomVisible.value = true;
  } else {
    academicCustomLabel.value = '所属';
    academicCustomVisible.value = false;
    academicCustomValue.value = '';
  }
};

const renderAcademicLevel = (level, depth) => {
  if (!level) return;
  const levelData = {
    label: level.label || '所属',
    placeholder: level.placeholder || `${level.label || '所属'}を選択してください`,
    allowCustom: level.allowCustom !== false,
    options: level.options || [],
  };
  if (depth < academicLevels.value.length) {
    academicLevels.value[depth] = levelData;
    // 選択値をリセット
    if (depth < academicSelections.value.length) {
      academicSelections.value[depth] = '';
    } else {
      academicSelections.value.push('');
    }
  } else {
    academicLevels.value.push(levelData);
    academicSelections.value.push('');
  }
};

const handleAcademicLevelChange = (depth) => {
  removeAcademicFieldsAfter(depth);
  const selectedValue = academicSelections.value[depth];
  if (!selectedValue) {
    updateAcademicCustomField();
    return;
  }
  const levelData = academicLevels.value[depth];
  if (!levelData) return;
  if (selectedValue === CUSTOM_OPTION_VALUE) {
    updateAcademicCustomField(levelData.label);
    return;
  }
  updateAcademicCustomField();
  const option = levelData.options.find((opt) => opt.value === selectedValue);
  if (option?.children) {
    renderAcademicLevel(option.children, depth + 1);
  }
};

const handleFacultyChange = () => {
  clearAcademicFields();
  const selectedFaculty = faculty.value;
  if (!selectedFaculty || selectedFaculty === CUSTOM_OPTION_VALUE) {
    return;
  }
  const facultyEntry = facultyOptions.value.find((entry) => entry.faculty === selectedFaculty);
  if (facultyEntry?.unitTree) {
    renderAcademicLevel(facultyEntry.unitTree, 0);
  } else if (facultyEntry?.fallbackLabel) {
    updateAcademicCustomField(facultyEntry.fallbackLabel);
  } else {
    updateAcademicCustomField('所属');
  }
};

const collectAcademicPathState = () => {
  const path = [];
  let requiresCustom = false;
  let customLabel = '';
  let firstSelect = null;
  let pendingSelect = null;
  for (let depth = 0; depth < academicLevels.value.length; depth++) {
    const levelData = academicLevels.value[depth];
    const value = academicSelections.value[depth] || '';
    const selectElement = document.getElementById(`gl-academic-select-${depth}`);
    if (!firstSelect) {
      firstSelect = selectElement;
    }
    if (!value && !pendingSelect) {
      pendingSelect = selectElement;
    }
    if (!value) continue;
    if (value === CUSTOM_OPTION_VALUE) {
      requiresCustom = true;
      customLabel = levelData?.label || customLabel;
      path.push({
        label: levelData?.label || '',
        value: academicCustomValue.value,
        isCustom: true,
        element: document.getElementById('gl-academic-custom'),
      });
      continue;
    }
    const option = levelData?.options.find((opt) => opt.value === value);
    path.push({
      label: levelData?.label || '',
      value: option?.value || value,
      displayLabel: option?.label || value,
      isCustom: false,
      element: selectElement,
    });
  }
  if (academicLevels.value.length === 0 && academicCustomVisible.value) {
    requiresCustom = true;
    customLabel = academicCustomLabel.value;
    path.push({
      label: academicCustomLabel.value,
      value: academicCustomValue.value,
      isCustom: true,
      element: document.getElementById('gl-academic-custom'),
    });
  }
  return {
    path,
    requiresCustom,
    customLabel,
    customValue: academicCustomValue.value,
    firstSelect,
    pendingSelect,
  };
};

const collectShifts = () => {
  const result = {};
  availableSchedules.value.forEach((schedule) => {
    result[schedule.id] = selectedShifts.value.includes(schedule.id);
  });
  return result;
};

const prepareForm = async () => {
  clearContextGuard();
  const params = new URLSearchParams(window.location.search || '');
  const extractedSlug = ensureString(params.get('evt'));
  if (!extractedSlug) {
    setContextGuard('このフォームは専用URLからアクセスしてください。');
    return;
  }
  slug.value = extractedSlug;
  const slugRef = dbRef(database, `glIntake/slugIndex/${extractedSlug}`);
  const slugSnap = await get(slugRef);
  if (!slugSnap.exists()) {
    setContextGuard('募集が終了したか、URLが無効です。運営までお問い合わせください。');
    return;
  }
  const extractedEventId = ensureString(slugSnap.val());
  if (!extractedEventId) {
    setContextGuard('イベント情報を特定できませんでした。運営までお問い合わせください。');
    return;
  }
  eventId.value = extractedEventId;
  let catalogFaculties = [];
  try {
    const catalogRef = dbRef(database, 'glIntake/facultyCatalog');
    const catalogSnap = await get(catalogRef);
    if (catalogSnap.exists()) {
      const catalogData = catalogSnap.val();
      catalogFaculties = parseFaculties(catalogData.faculties || []);
    }
  } catch (error) {
    console.error('Failed to fetch faculty catalog:', error);
  }
  const configRef = dbRef(database, `glIntake/events/${extractedEventId}`);
  const configSnap = await get(configRef);
  const config = configSnap.val() || {};
  const now = Date.now();
  const startAt = parseTimestamp(config.startAt);
  const endAt = parseTimestamp(config.endAt);
  if (startAt && now < startAt) {
    setContextGuard('まだ募集開始前です。募集開始までお待ちください。');
    return;
  }
  if (endAt && now > endAt) {
    setContextGuard('募集期間が終了しました。運営までお問い合わせください。');
    return;
  }
  facultyOptions.value = catalogFaculties.length > 0 ? catalogFaculties : parseFaculties(config.faculties || []);
  const scheduleSources = [config.schedules, config.scheduleSummary, config.scheduleOptions];
  let parsedSchedules = [];
  for (const source of scheduleSources) {
    parsedSchedules = parseSchedules(source);
    if (parsedSchedules.length) {
      break;
    }
  }
  if (parsedSchedules.length > 0) {
    try {
      const schedulesRef = dbRef(database, `questionIntake/schedules/${extractedEventId}`);
      const schedulesSnap = await get(schedulesRef);
      if (schedulesSnap.exists()) {
        const schedulesData = schedulesSnap.val() || {};
        parsedSchedules = parsedSchedules.map((schedule) => {
          const scheduleData = schedulesData[schedule.id];
          if (scheduleData && typeof scheduleData === 'object') {
            return {
              ...schedule,
              recruitGl: scheduleData.recruitGl !== false,
            };
          }
          return schedule;
        });
      }
    } catch (error) {
      console.warn('Failed to fetch schedule recruitGl info, using defaults', error);
    }
  }
  schedules.value = parsedSchedules;
  let extractedEventName = extractedEventId;
  try {
    const eventRef = dbRef(database, `questionIntake/events/${extractedEventId}`);
    const eventSnap = await get(eventRef);
    if (eventSnap.exists()) {
      const eventData = eventSnap.val() || {};
      extractedEventName = ensureString(eventData.name || extractedEventId);
    }
  } catch (error) {
    console.warn('Failed to fetch event name, using eventId as fallback', error);
  }
  eventName.value = extractedEventName;
  periodText.value = formatPeriod(startAt, endAt);
  clearContextGuard();
};

const validateAllFields = () => {
  clearAllFieldErrors();
  let hasError = false;
  let firstErrorElement = null;

  // 上から順番にバリデーション
  // 1. 氏名
  const nameValue = ensureString(name.value);
  if (!nameValue) {
    setFieldError('name', '氏名を入力してください。');
    if (!firstErrorElement) {
      firstErrorElement = document.getElementById('gl-name');
    }
    hasError = true;
  }

  // 2. メールアドレス
  const emailValue = ensureString(email.value);
  if (!emailValue) {
    setFieldError('email', 'メールアドレスを入力してください。');
    if (!firstErrorElement) {
      firstErrorElement = document.getElementById('gl-email');
    }
    hasError = true;
  } else {
    const emailElement = document.getElementById('gl-email');
    if (emailElement && !emailElement.checkValidity()) {
      if (emailElement.validity.typeMismatch) {
        setFieldError('email', '正しいメールアドレスを入力してください。');
      } else {
        setFieldError('email', 'メールアドレスの形式が正しくありません。');
      }
      if (!firstErrorElement) {
        firstErrorElement = emailElement;
      }
      hasError = true;
    }
  }

  // 3. 学部
  const facultyValue = ensureString(faculty.value);
  if (!facultyValue || facultyValue === CUSTOM_OPTION_VALUE) {
    setFieldError('faculty', '学部を選択してください。');
    if (!firstErrorElement) {
      firstErrorElement = document.getElementById('gl-faculty');
    }
    hasError = true;
  }

  // 4. 学歴パス
  const academic = collectAcademicPathState();
  if (academic.pendingSelect) {
    const label = ensureString(academic.pendingSelect.dataset?.levelLabel) || '所属';
    const depth = Number(academic.pendingSelect.dataset?.depth ?? '0');
    setFieldError(`academic-${depth}`, `${label}を選択してください。`);
    if (!firstErrorElement) {
      firstErrorElement = academic.pendingSelect;
    }
    hasError = true;
  } else if (!academic.path.length) {
    const label = academicCustomLabel.value || '所属情報';
    if (academic.firstSelect) {
      const depth = Number(academic.firstSelect.dataset?.depth ?? '0');
      setFieldError(`academic-${depth}`, `${label}を選択してください。`);
      if (!firstErrorElement) {
        firstErrorElement = academic.firstSelect;
      }
    } else if (academicCustomVisible.value) {
      setFieldError('academic-custom', `${label}を入力してください。`);
      if (!firstErrorElement) {
        firstErrorElement = document.getElementById('gl-academic-custom');
      }
    }
    hasError = true;
  } else if (academic.requiresCustom && !academic.customValue) {
    const label = academic.customLabel || academicCustomLabel.value || '所属';
    setFieldError('academic-custom', `${label}を入力してください。`);
    if (!firstErrorElement) {
      firstErrorElement = document.getElementById('gl-academic-custom');
    }
    hasError = true;
  } else {
    const departmentSegment = academic.path[academic.path.length - 1];
    const department = ensureString(departmentSegment?.value);
    if (!department) {
      const label = ensureString(departmentSegment?.label) || '所属';
      if (departmentSegment?.isCustom) {
        setFieldError('academic-custom', `${label}を入力してください。`);
        if (!firstErrorElement) {
          firstErrorElement = document.getElementById('gl-academic-custom');
        }
      } else if (departmentSegment?.element) {
        const depth = Number(departmentSegment.element.dataset?.depth ?? '0');
        setFieldError(`academic-${depth}`, `${label}を選択してください。`);
        if (!firstErrorElement) {
          firstErrorElement = departmentSegment.element;
        }
      }
      hasError = true;
    }
  }

  // 5. シフト
  const shifts = collectShifts();
  if (schedules.value.length && !Object.values(shifts).some(Boolean)) {
    setFieldError('shifts', '参加可能な日程にチェックを入れてください。');
    if (!firstErrorElement) {
      firstErrorElement = document.querySelector('#gl-shift-list input[type="checkbox"]');
    }
    hasError = true;
  }

  // 6. 個人情報の取扱いについて同意
  if (!privacyConsent.value) {
    setFieldError('privacy-consent', '個人情報の取扱いについて同意してください。');
    if (!firstErrorElement) {
      firstErrorElement = document.getElementById('gl-privacy-consent');
    }
    hasError = true;
  }

  if (hasError && firstErrorElement) {
    firstErrorElement.focus();
  }

  return !hasError;
};

const handleSubmit = async (event) => {
  event.preventDefault();
  clearFeedback();
  if (formLocked.value) return;
  if (!eventId.value) {
    setFeedback('イベント情報が取得できませんでした。運営までお問い合わせください。', 'error');
    return;
  }

  // 上から順番にバリデーション
  if (!validateAllFields()) {
    return;
  }

  const facultyValue = ensureString(faculty.value);
  const academic = collectAcademicPathState();
  const departmentSegment = academic.path[academic.path.length - 1];
  const department = ensureString(departmentSegment?.value);
  const shifts = collectShifts();
  const academicPath = academic.path
    .map((segment) => ({
      label: ensureString(segment.label),
      value: ensureString(segment.value),
      display: ensureString(segment.displayLabel ?? segment.value),
      isCustom: Boolean(segment.isCustom),
    }))
    .filter((segment) => segment.value);
  const nameValue = ensureString(name.value);
  const emailValue = ensureString(email.value);
  const payload = {
    name: nameValue,
    phonetic: ensureString(phonetic.value),
    grade: ensureString(grade.value),
    gender: ensureString(gender.value),
    faculty: facultyValue,
    department,
    academicPath,
    email: emailValue,
    club: ensureString(club.value),
    studentId: ensureString(studentId.value),
    note: ensureString(note.value),
    shifts,
    eventId: eventId.value,
    slug: slug.value,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  if (privacyConsent.value) {
    payload.privacyConsent = true;
  }
  if (!payload.note) {
    delete payload.note;
  }
  if (!payload.gender) {
    delete payload.gender;
  }
  isSubmitting.value = true;
  setFeedback('送信しています…', 'progress');
  try {
    const applicationsRef = dbRef(database, `glIntake/applications/${eventId.value}`);
    const recordRef = push(applicationsRef);
    await set(recordRef, payload);
    setFeedback('応募を受け付けました。ご協力ありがとうございます。', 'success');
    // フォームをリセット
    name.value = '';
    phonetic.value = '';
    email.value = '';
    grade.value = '';
    gender.value = '';
    faculty.value = '';
    studentId.value = '';
    club.value = '';
    note.value = '';
    privacyConsent.value = false;
    selectedShifts.value = [];
    clearAcademicFields();
    handleFacultyChange();
    // フォームを非表示にしてメタ情報を表示
    formLocked.value = true;
    submissionSuccess.value = true;
  } catch (error) {
    console.error(error);
    setFeedback('送信に失敗しました。時間をおいて再度お試しください。', 'error');
  } finally {
    isSubmitting.value = false;
  }
};

onMounted(async () => {
  try {
    await prepareForm();
  } catch (error) {
    console.error(error);
    setContextGuard('フォームの初期化に失敗しました。時間をおいて再度お試しください。');
  }
});
</script>

