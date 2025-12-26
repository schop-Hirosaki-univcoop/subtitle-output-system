<template>
  <IntakeFormLayout
    title="GL応募フォーム"
    description="運営から案内されたURLからアクセスし、必要事項をご入力ください。"
    title-id="gl-form-title"
    description-id="gl-form-description"
  >
    <!-- コンテキストバナー -->
    <ContextBanner :visible="contextBannerVisible" id="gl-context-banner">
      <p v-if="eventName" id="gl-context-event" class="context-text">対象イベント: {{ eventName }}</p>
      <p v-if="periodText" id="gl-context-period" class="context-text">募集期間: {{ periodText }}</p>
    </ContextBanner>

    <!-- 利用制限表示 -->
    <ContextGuard :message="contextGuardMessage" id="gl-context-guard" />

      <!-- GL応募フォーム -->
      <form v-if="!isLocked" id="gl-entry-form" class="intake-form" novalidate @submit.prevent="handleSubmit">
        <input id="gl-event-id" name="event-id" type="hidden" :value="eventId" />
        <input id="gl-slug" name="form-slug" type="hidden" :value="slug" />

        <!-- 氏名 -->
        <FormField
          label="氏名"
          field-id="gl-name"
          :required="true"
          :error="fieldErrors.name"
          error-id="gl-name-error"
        >
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
        </FormField>

        <!-- フリガナ -->
        <FormField
          label="フリガナ"
          field-id="gl-phonetic"
          :required="true"
          :error="fieldErrors.phonetic"
          error-id="gl-phonetic-error"
        >
          <input
            id="gl-phonetic"
            v-model="phonetic"
            name="phonetic"
            class="input"
            type="text"
            autocomplete="off"
            required
            :aria-invalid="fieldErrors.phonetic ? 'true' : undefined"
            :aria-describedby="fieldErrors.phonetic ? 'gl-phonetic-error' : undefined"
            @blur="validateField('phonetic')"
            @input="clearFieldError('phonetic')"
          />
        </FormField>

        <!-- メールアドレス -->
        <FormField
          label="メールアドレス"
          field-id="gl-email"
          :required="true"
          :error="fieldErrors.email"
          error-id="gl-email-error"
        >
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
        </FormField>

        <!-- 学年 -->
        <FormField
          label="学年"
          field-id="gl-grade"
          :required="true"
          :error="fieldErrors.grade"
          error-id="gl-grade-error"
        >
          <select
            id="gl-grade"
            v-model="grade"
            name="grade"
            class="input"
            required
            :aria-invalid="fieldErrors.grade ? 'true' : undefined"
            :aria-describedby="fieldErrors.grade ? 'gl-grade-error' : undefined"
            @blur="validateField('grade')"
            @change="clearFieldError('grade')"
          >
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
        </FormField>

        <!-- 性別 -->
        <FormField
          label="性別"
          field-id="gl-gender"
          :required="true"
          :error="fieldErrors.gender"
          error-id="gl-gender-error"
        >
          <select
            id="gl-gender"
            v-model="gender"
            name="gender"
            class="input"
            required
            :aria-invalid="fieldErrors.gender ? 'true' : undefined"
            :aria-describedby="fieldErrors.gender ? 'gl-gender-error' : undefined"
            @blur="validateField('gender')"
            @change="clearFieldError('gender')"
          >
            <option value="" data-placeholder="true" disabled>性別を選択してください</option>
            <option value="男性">男性</option>
            <option value="女性">女性</option>
            <option value="その他">その他</option>
            <option value="回答しない">回答しない</option>
          </select>
        </FormField>

        <!-- 学部 -->
        <FormField
          label="学部"
          field-id="gl-faculty"
          :required="true"
          :error="fieldErrors.faculty"
          error-id="gl-faculty-error"
        >
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
        </FormField>

        <!-- 学歴フィールド（動的生成） -->
        <div id="gl-academic-fields">
          <FormField
            v-for="(level, depth) in academicLevels"
            :key="`academic-${depth}`"
            :label="level.label"
            :field-id="`gl-academic-select-${depth}`"
            :required="true"
            :error="fieldErrors[`academic-${depth}`]"
            :error-id="`gl-academic-select-${depth}-error`"
            field-class="gl-academic-field"
            :data-depth="depth"
          >
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
          </FormField>
        </div>

        <!-- カスタム学歴フィールド -->
        <FormField
          v-if="academicCustomVisible"
          :label="`${academicCustomLabel}（その他入力）`"
          field-id="gl-academic-custom"
          :required="academicCustomVisible"
          :error="fieldErrors['academic-custom']"
          error-id="gl-academic-custom-error"
          id="gl-academic-custom-field"
        >
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
        </FormField>

        <!-- 学籍番号 -->
        <FormField
          label="学籍番号"
          field-id="gl-student-id"
          :required="true"
          :error="fieldErrors.studentId"
          error-id="gl-student-id-error"
        >
          <input
            id="gl-student-id"
            v-model="studentId"
            name="student-id"
            class="input"
            type="text"
            autocomplete="off"
            required
            :aria-invalid="fieldErrors.studentId ? 'true' : undefined"
            :aria-describedby="fieldErrors.studentId ? 'gl-student-id-error' : undefined"
            @blur="validateField('studentId')"
            @input="clearFieldError('studentId')"
          />
        </FormField>

        <!-- 所属している部活・サークル -->
        <FormField label="所属している部活・サークル" field-id="gl-club">
          <input id="gl-club" v-model="club" name="club" class="input" type="text" autocomplete="off" />
        </FormField>

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
        <FormField label="備考・連絡事項" field-id="gl-note" :optional="true">
          <textarea id="gl-note" v-model="note" name="note" class="input input--textarea" rows="4" placeholder="連絡事項があればご記入ください"></textarea>
        </FormField>

        <!-- 個人情報の取扱いについて同意 -->
        <FormField
          field-id="gl-privacy-consent"
          :required="true"
          :error="fieldErrors['privacy-consent']"
          error-id="gl-privacy-consent-error"
        >
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
        </FormField>

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
      <FormMeta :visible="formMetaVisible" id="gl-form-meta">
        <p class="form-meta-line">送信完了後、運営からの案内をお待ちください。</p>
        <p class="form-meta-line">入力内容に誤りがあった場合は、案内元までご連絡ください。</p>
      </FormMeta>
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
import ContextBanner from './ContextBanner.vue';
import FormActions from './FormActions.vue';
import FormMeta from './FormMeta.vue';
import FormField from './FormField.vue';
import FormFieldError from './FormFieldError.vue';
import { useFormFeedback } from '../composables/useFormFeedback.js';
import { useFormGuard } from '../composables/useFormGuard.js';
import { useFormState } from '../composables/useFormState.js';
import { useFormValidation } from '../composables/useFormValidation.js';
import { useFormReset } from '../composables/useFormReset.js';

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

// 共通Composables
const { feedbackMessage, feedbackType, setFeedback, clearFeedback } = useFormFeedback();
const { isLocked, isSubmitting, submissionSuccess, lockForm, unlockForm, setSubmitting, setSubmissionSuccess } = useFormState();
const { contextGuardMessage, setContextGuard, clearContextGuard } = useFormGuard({
  onLock: lockForm,
  onUnlock: unlockForm,
  guardElementId: 'gl-context-guard',
});
const { fieldErrors, setFieldError, clearFieldError, clearAllFieldErrors, validateField, validateAcademicField } = useFormValidation();

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

// フィールドエラーはuseFormValidationで管理

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

// 送信成功フラグはuseFormStateで管理

// Computed
const contextBannerVisible = computed(() => Boolean(eventName.value || periodText.value));
const formMetaVisible = computed(() => submissionSuccess.value);
// 互換性のため
const formLocked = isLocked;
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

// バリデーション関数はuseFormValidationで管理

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

  // 2. フリガナ
  const phoneticValue = ensureString(phonetic.value);
  if (!phoneticValue) {
    setFieldError('phonetic', 'フリガナを入力してください。');
    if (!firstErrorElement) {
      firstErrorElement = document.getElementById('gl-phonetic');
    }
    hasError = true;
  }

  // 3. メールアドレス
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

  // 4. 学年
  const gradeValue = ensureString(grade.value);
  if (!gradeValue) {
    setFieldError('grade', '学年を選択してください。');
    if (!firstErrorElement) {
      firstErrorElement = document.getElementById('gl-grade');
    }
    hasError = true;
  }

  // 5. 性別
  const genderValue = ensureString(gender.value);
  if (!genderValue) {
    setFieldError('gender', '性別を選択してください。');
    if (!firstErrorElement) {
      firstErrorElement = document.getElementById('gl-gender');
    }
    hasError = true;
  }

  // 6. 学部
  const facultyValue = ensureString(faculty.value);
  if (!facultyValue || facultyValue === CUSTOM_OPTION_VALUE) {
    setFieldError('faculty', '学部を選択してください。');
    if (!firstErrorElement) {
      firstErrorElement = document.getElementById('gl-faculty');
    }
    hasError = true;
  }

  // 4. 学歴パス
  // リアクティブなacademicLevelsを直接チェック（学部選択直後に追加されたプルダウンも確実にチェック）
  for (let depth = 0; depth < academicLevels.value.length; depth++) {
    const levelData = academicLevels.value[depth];
    const value = academicSelections.value[depth] || '';
    if (!value || value === '') {
      const label = ensureString(levelData?.label) || '所属';
      setFieldError(`academic-${depth}`, `${label}を選択してください。`);
      if (!firstErrorElement) {
        firstErrorElement = document.getElementById(`gl-academic-select-${depth}`);
      }
      hasError = true;
    }
  }
  // カスタム学歴フィールドのチェック
  const academic = collectAcademicPathState();
  if (academic.requiresCustom && !academic.customValue) {
    const label = academic.customLabel || academicCustomLabel.value || '所属';
    setFieldError('academic-custom', `${label}を入力してください。`);
    if (!firstErrorElement) {
      firstErrorElement = document.getElementById('gl-academic-custom');
    }
    hasError = true;
  }

  // 7. 学籍番号
  const studentIdValue = ensureString(studentId.value);
  if (!studentIdValue) {
    setFieldError('studentId', '学籍番号を入力してください。');
    if (!firstErrorElement) {
      firstErrorElement = document.getElementById('gl-student-id');
    }
    hasError = true;
  }

  // 8. シフト
  const shifts = collectShifts();
  if (schedules.value.length && !Object.values(shifts).some(Boolean)) {
    setFieldError('shifts', '参加可能な日程にチェックを入れてください。');
    if (!firstErrorElement) {
      firstErrorElement = document.querySelector('#gl-shift-list input[type="checkbox"]');
    }
    hasError = true;
  }

  // 9. 個人情報の取扱いについて同意
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
  if (isLocked.value) return;
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
  setSubmitting(true);
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
    lockForm();
    setSubmissionSuccess(true);
  } catch (error) {
    console.error(error);
    setFeedback('送信に失敗しました。時間をおいて再度お試しください。', 'error');
  } finally {
    setSubmitting(false);
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

