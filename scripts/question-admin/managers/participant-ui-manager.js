// participant-ui-manager.js: 参加者 UI 関連の機能を担当します。
export class ParticipantUIManager {
  constructor(context) {
    this.state = context.state;
    this.dom = context.dom;
    
    // 依存関数
    this.normalizeGroupNumberValue = context.normalizeGroupNumberValue;
    this.getDisplayParticipantId = context.getDisplayParticipantId;
    this.resolveMailStatusInfo = context.resolveMailStatusInfo;
    this.resolveParticipantUid = context.resolveParticipantUid;
    this.updateParticipantActionPanelState = context.updateParticipantActionPanelState;
    this.applyParticipantNoText = context.applyParticipantNoText;
    this.createShareUrl = context.createShareUrl;
    this.describeDuplicateMatch = context.describeDuplicateMatch;
    this.sortParticipants = context.sortParticipants;
    this.ensureRowKey = context.ensureRowKey;
    this.resolveParticipantStatus = context.resolveParticipantStatus;
    this.ensureTeamAssignmentMap = context.ensureTeamAssignmentMap;
    this.applyAssignmentsToEventCache = context.applyAssignmentsToEventCache;
    this.syncCurrentScheduleCache = context.syncCurrentScheduleCache;
    this.updateDuplicateMatches = context.updateDuplicateMatches;
    this.renderParticipants = context.renderParticipants;
    this.syncSaveButtonState = context.syncSaveButtonState;
    this.setUploadStatus = context.setUploadStatus;
    this.hasUnsavedChanges = context.hasUnsavedChanges;
    this.relocationManager = context.relocationManager;
    this.diffParticipantLists = context.diffParticipantLists;
    this.copyShareLink = context.copyShareLink;
    
    // 定数
    this.CANCEL_LABEL = context.CANCEL_LABEL;
    this.RELOCATE_LABEL = context.RELOCATE_LABEL;
    this.GL_STAFF_GROUP_KEY = context.GL_STAFF_GROUP_KEY;
    this.GL_STAFF_LABEL = context.GL_STAFF_LABEL;
    this.NO_TEAM_GROUP_KEY = context.NO_TEAM_GROUP_KEY;
    this.MAIL_STATUS_ICON_SVG = context.MAIL_STATUS_ICON_SVG;
    this.CHANGE_ICON_SVG = context.CHANGE_ICON_SVG;
  }

  /**
   * 参加者グループキーの取得
   * @param {Object} entry - 参加者エントリ
   * @returns {string} グループキー
   */
  getParticipantGroupKey(entry) {
    const raw = entry && entry.groupNumber;
    const value = raw != null ? String(raw).trim() : "";
    if (!value) {
      return this.NO_TEAM_GROUP_KEY;
    }
    if (value === this.CANCEL_LABEL || value === this.RELOCATE_LABEL || value === this.GL_STAFF_GROUP_KEY) {
      return value;
    }
    const normalized = this.normalizeGroupNumberValue(value);
    return normalized || this.NO_TEAM_GROUP_KEY;
  }

  /**
   * 参加者グループの説明
   * @param {string} groupKey - グループキー
   * @returns {Object} グループ説明オブジェクト
   */
  describeParticipantGroup(groupKey) {
    const raw = String(groupKey || "").trim();
    if (!raw || raw === this.NO_TEAM_GROUP_KEY) {
      return { label: "班番号", value: "未設定" };
    }
    if (raw === this.CANCEL_LABEL) {
      return { label: "ステータス", value: this.CANCEL_LABEL };
    }
    if (raw === this.RELOCATE_LABEL) {
      return { label: "ステータス", value: this.RELOCATE_LABEL };
    }
    if (raw === this.GL_STAFF_GROUP_KEY) {
      return { label: "ステータス", value: this.GL_STAFF_LABEL };
    }
    const normalized = this.normalizeGroupNumberValue(raw) || raw;
    return { label: "班番号", value: normalized };
  }

  /**
   * 参加者グループ要素の作成
   * @param {string} groupKey - グループキー
   * @returns {Object} グループ要素オブジェクト
   */
  createParticipantGroupElements(groupKey) {
    const { label, value } = this.describeParticipantGroup(groupKey);
    const section = document.createElement("section");
    section.className = "participant-card-group";
    section.setAttribute("role", "group");
    if (groupKey && groupKey !== this.NO_TEAM_GROUP_KEY) {
      section.dataset.team = groupKey;
    }
    if (label || value) {
      section.setAttribute("aria-label", `${label} ${value}`.trim());
    }

    const header = document.createElement("header");
    header.className = "participant-card-group__header";

    const badge = document.createElement("span");
    badge.className = "participant-card-group__badge";
    const badgeLabel = document.createElement("span");
    badgeLabel.className = "participant-card-group__badge-label";
    badgeLabel.textContent = label;
    const badgeValue = document.createElement("span");
    badgeValue.className = "participant-card-group__badge-value";
    badgeValue.textContent = value;
    badge.append(badgeLabel, badgeValue);

    const countElement = document.createElement("span");
    countElement.className = "participant-card-group__count";

    const cardsContainer = document.createElement("div");
    cardsContainer.className = "participant-card-group__cards";

    const leadersContainer = document.createElement("div");
    leadersContainer.className = "participant-card-group__leaders";
    leadersContainer.hidden = true;

    const leadersLabel = document.createElement("span");
    leadersLabel.className = "participant-card-group__leaders-label";
    leadersLabel.textContent = "GL";

    const leadersList = document.createElement("div");
    leadersList.className = "participant-card-group__leaders-list";

    leadersContainer.append(leadersLabel, leadersList);

    header.append(badge, leadersContainer, countElement);
    section.append(header, cardsContainer);

    return {
      section,
      cardsContainer,
      countElement,
      leadersContainer,
      leadersList,
      key: groupKey
    };
  }

  /**
   * 参加者識別子のフォーマット
   * @param {Object} entry - 参加者エントリ
   * @returns {string} フォーマットされた識別子
   */
  formatParticipantIdentifier(entry) {
    if (!entry) {
      return "参加者";
    }
    const name = String(entry.name || "").trim();
    if (name) {
      return `参加者「${name}」`;
    }
    const displayId = this.getDisplayParticipantId(entry.participantId);
    if (displayId) {
      return `UID: ${displayId}`;
    }
    return "UID未設定";
  }

  /**
   * 参加者バッジの作成
   * @param {string} label - ラベル
   * @param {string} value - 値
   * @param {Object} options - オプション
   * @param {boolean} options.hideLabel - ラベルを非表示にするか
   * @returns {HTMLElement} バッジ要素
   */
  createParticipantBadge(label, value, { hideLabel = false } = {}) {
    const badge = document.createElement("span");
    badge.className = "participant-badge";
    const textValue = value ? String(value) : "—";
    if (!hideLabel && label) {
      const labelSpan = document.createElement("span");
      labelSpan.className = "participant-badge__label";
      labelSpan.textContent = label;
      badge.appendChild(labelSpan);
    }
    const valueSpan = document.createElement("span");
    valueSpan.className = "participant-badge__value";
    valueSpan.textContent = textValue;
    if (label) {
      badge.title = `${label}: ${textValue}`;
    }
    badge.appendChild(valueSpan);
    return badge;
  }

  /**
   * メールステータスバッジの作成
   * @param {Object} entry - 参加者エントリ
   * @returns {Object} バッジと情報のオブジェクト
   */
  createMailStatusBadge(entry) {
    const info = this.resolveMailStatusInfo(entry);
    const badge = document.createElement("span");
    badge.className = "participant-badge participant-mail-badge";
    const statusKey = info.key || "unknown";
    badge.dataset.mailStatus = statusKey;
    badge.classList.add(`participant-mail-badge--${statusKey}`);
    if (info.description) {
      badge.title = info.description;
    } else {
      badge.removeAttribute("title");
    }
    badge.setAttribute("role", "text");
    badge.setAttribute("aria-label", info.ariaLabel || info.label);

    const icon = document.createElement("span");
    icon.className = "participant-mail-badge__icon";
    icon.setAttribute("aria-hidden", "true");
    icon.innerHTML = this.MAIL_STATUS_ICON_SVG[statusKey] || this.MAIL_STATUS_ICON_SVG.default;

    const text = document.createElement("span");
    text.className = "participant-badge__value participant-mail-badge__text";
    text.textContent = info.label;

    badge.append(icon, text);
    return { badge, info };
  }

  /**
   * エントリ識別子の取得
   * @param {Object} entry - 参加者エントリ
   * @returns {Object} 識別子オブジェクト
   */
  getEntryIdentifiers(entry) {
    const rowKey = entry && entry.rowKey != null ? String(entry.rowKey) : "";
    const participantId = entry && entry.participantId != null ? String(entry.participantId) : "";
    const uidValue = this.resolveParticipantUid(entry);
    const uid = uidValue != null ? String(uidValue) : "";
    return { rowKey, participantId, uid };
  }

  /**
   * エントリが現在選択されているかどうかを判定
   * @param {Object} entry - 参加者エントリ
   * @returns {boolean} 選択されているかどうか
   */
  isEntryCurrentlySelected(entry) {
    if (!entry) {
      return false;
    }
    const identifiers = this.getEntryIdentifiers(entry);
    const selectedRowKey = String(this.state.selectedParticipantRowKey || "");
    if (selectedRowKey) {
      return identifiers.rowKey && identifiers.rowKey === selectedRowKey;
    }
    const selectedId = String(this.state.selectedParticipantId || "");
    if (!selectedId) {
      return false;
    }
    return (
      (identifiers.participantId && identifiers.participantId === selectedId) ||
      (identifiers.uid && identifiers.uid === selectedId)
    );
  }

  /**
   * 選択された参加者ターゲットの取得
   * @returns {Object} ターゲットオブジェクト（entry, index）
   */
  getSelectedParticipantTarget() {
    const selectedRowKey = String(this.state.selectedParticipantRowKey || "");
    const selectedId = String(this.state.selectedParticipantId || "");
    if (!selectedRowKey && !selectedId) {
      return { entry: null, index: -1 };
    }
    const target = this.resolveParticipantActionTarget({ rowKey: selectedRowKey, participantId: selectedId });
    if (!target.entry) {
      this.clearParticipantSelection({ silent: true });
      this.applyParticipantSelectionStyles();
      return { entry: null, index: -1 };
    }
    return target;
  }

  /**
   * 参加者選択スタイルの適用
   * @param {Object} options - オプション
   * @param {HTMLElement} options.focusCard - フォーカスするカード要素
   */
  applyParticipantSelectionStyles({ focusCard = null } = {}) {
    const list = this.dom.participantCardList;
    if (!list) {
      return;
    }
    const cards = list.querySelectorAll(".participant-card");
    const selectedRowKey = String(this.state.selectedParticipantRowKey || "");
    const selectedId = String(this.state.selectedParticipantId || "");
    const shouldFocus = Boolean(focusCard);
    let focusTarget = focusCard || null;
    cards.forEach(card => {
      const rowKey = card.dataset.rowKey ? String(card.dataset.rowKey) : "";
      const participantId = card.dataset.participantId ? String(card.dataset.participantId) : "";
      const uid = card.dataset.uid ? String(card.dataset.uid) : "";
      const matches = selectedRowKey
        ? rowKey && rowKey === selectedRowKey
        : selectedId && (participantId === selectedId || uid === selectedId);
      card.classList.toggle("is-selected", matches);
      card.setAttribute("aria-selected", matches ? "true" : "false");
      if (shouldFocus && matches && !focusTarget) {
        focusTarget = card;
      }
    });
    if (shouldFocus && focusTarget) {
      focusTarget.focus();
    }
  }

  /**
   * 参加者選択のクリア
   * @param {Object} options - オプション
   * @param {boolean} options.silent - サイレントモード（スタイル更新をスキップ）
   */
  clearParticipantSelection({ silent = false } = {}) {
    this.state.selectedParticipantRowKey = "";
    this.state.selectedParticipantId = "";
    if (!silent) {
      this.applyParticipantSelectionStyles();
      this.updateParticipantActionPanelState();
    }
  }

  /**
   * カード要素からの参加者選択
   * @param {HTMLElement} card - 参加者カード要素
   * @param {Object} options - オプション
   * @param {boolean} options.focus - フォーカスするかどうか
   */
  selectParticipantFromCardElement(card, { focus = false } = {}) {
    if (!card) {
      return;
    }
    const rowKey = card.dataset.rowKey ? String(card.dataset.rowKey) : "";
    const participantId = card.dataset.participantId ? String(card.dataset.participantId) : "";
    const uid = card.dataset.uid ? String(card.dataset.uid) : "";
    const currentRowKey = String(this.state.selectedParticipantRowKey || "");
    const currentId = String(this.state.selectedParticipantId || "");
    const nextId = participantId || uid || "";
    if (currentRowKey === rowKey && currentId === nextId) {
      if (focus) {
        card.focus();
      }
      return;
    }
    this.state.selectedParticipantRowKey = rowKey;
    this.state.selectedParticipantId = nextId;
    this.applyParticipantSelectionStyles({ focusCard: focus ? card : null });
    this.updateParticipantActionPanelState();
  }

  /**
   * 参加者カードの構築
   * @param {Object} entry - 参加者エントリ
   * @param {number} index - インデックス
   * @param {Object} options - オプション
   * @param {Object} options.changeInfo - 変更情報
   * @param {Map} options.duplicateMap - 重複マップ
   * @param {string} options.eventId - イベントID
   * @param {string} options.scheduleId - スケジュールID
   * @returns {Object} カードと選択状態のオブジェクト
   */
  buildParticipantCard(entry, index, { changeInfo, duplicateMap, eventId, scheduleId }) {
    const card = document.createElement("article");
    card.className = "participant-card";
    card.setAttribute("role", "listitem");

    const identifiers = this.getEntryIdentifiers(entry);
    if (identifiers.rowKey) {
      card.dataset.rowKey = identifiers.rowKey;
    }
    if (identifiers.participantId) {
      card.dataset.participantId = identifiers.participantId;
    }
    if (identifiers.uid) {
      card.dataset.uid = identifiers.uid;
    }
    card.dataset.rowIndex = String(index);

    const isSelected = this.isEntryCurrentlySelected(entry);
    card.classList.toggle("is-selected", isSelected);
    card.setAttribute("aria-selected", isSelected ? "true" : "false");
    card.tabIndex = 0;

    const header = document.createElement("header");
    header.className = "participant-card__header";

    const headerMain = document.createElement("div");
    headerMain.className = "participant-card__header-main";

    const badgeRow = document.createElement("div");
    badgeRow.className = "participant-card__badges";

    const numberBadge = document.createElement("span");
    numberBadge.className = "participant-card__no";
    this.applyParticipantNoText(numberBadge, index + 1);
    badgeRow.appendChild(numberBadge);

    const departmentText = entry.department || entry.groupNumber || "";
    const departmentBadge = this.createParticipantBadge("学部学科", departmentText, { hideLabel: true });
    badgeRow.appendChild(departmentBadge);

    const genderText = entry.gender || "";
    const genderBadge = this.createParticipantBadge("性別", genderText, { hideLabel: true });
    badgeRow.appendChild(genderBadge);

    const { badge: mailBadge, info: mailStatusInfo } = this.createMailStatusBadge(entry);
    badgeRow.appendChild(mailBadge);

    headerMain.appendChild(badgeRow);

    if (mailStatusInfo?.key) {
      card.dataset.mailStatus = mailStatusInfo.key;
      card.classList.add(`participant-card--mail-${mailStatusInfo.key}`);
    }

    const nameWrapper = document.createElement("span");
    nameWrapper.className = "participant-card__name participant-name";
    const phoneticText = entry.phonetic || entry.furigana || "";
    if (phoneticText) {
      const phoneticSpan = document.createElement("span");
      phoneticSpan.className = "participant-name__phonetic";
      phoneticSpan.textContent = phoneticText;
      nameWrapper.appendChild(phoneticSpan);
    }
    const fullNameSpan = document.createElement("span");
    fullNameSpan.className = "participant-name__text";
    fullNameSpan.textContent = entry.name || "";
    nameWrapper.appendChild(fullNameSpan);

    headerMain.appendChild(nameWrapper);

    header.appendChild(headerMain);

    const body = document.createElement("div");
    body.className = "participant-card__body";

    const actions = document.createElement("div");
    actions.className = "participant-card__actions";
    const linkRow = document.createElement("div");
    linkRow.className = "link-action-row participant-card__buttons participant-card__link-row";

    if (entry.token) {
      const shareUrl = this.createShareUrl(entry.token);
      const previewLink = document.createElement("a");
      previewLink.href = shareUrl;
      previewLink.target = "_blank";
      previewLink.rel = "noopener noreferrer";
      previewLink.className = "share-link-preview";
      previewLink.textContent = shareUrl;
      linkRow.appendChild(previewLink);

      const copyButton = document.createElement("button");
      copyButton.type = "button";
      copyButton.className = "link-action-btn copy-link-btn";
      copyButton.dataset.token = entry.token;
      copyButton.innerHTML = "<svg aria-hidden=\"true\" viewBox=\"0 0 16 16\"><path d=\"M6.25 1.75A2.25 2.25 0 0 0 4 4v7A2.25 2.25 0 0 0 6.25 13.25h4A2.25 2.25 0 0 0 12.5 11V4A2.25 2.25 0 0 0 10.25 1.75h-4Zm0 1.5h4c.414 0 .75.336.75.75v7c0 .414-.336.75-.75.75h-4a.75.75 0 0 1-.75-.75V4c0-.414.336-.75.75-.75ZM3 4.75A.75.75 0 0 0 2.25 5.5v7A2.25 2.25 0 0 0 4.5 14.75h4a.75.75 0 0 0 0-1.5h-4a.75.75 0 0 1-.75-.75v-7A.75.75 0 0 0 3 4.75Z\" fill=\"currentColor\"/></svg><span>コピー</span>";
      linkRow.appendChild(copyButton);
    } else {
      const placeholder = document.createElement("span");
      placeholder.className = "link-placeholder";
      placeholder.textContent = "リンク未発行";
      linkRow.appendChild(placeholder);
    }

    actions.appendChild(linkRow);

    body.appendChild(actions);

    const duplicateKey = entry.rowKey
      ? String(entry.rowKey)
      : entry.participantId
        ? String(entry.participantId)
        : `__row${index}`;
    const duplicateInfo = duplicateMap.get(duplicateKey);
    const matches = duplicateInfo?.others || [];
    const duplicateCount = duplicateInfo?.totalCount || (matches.length ? matches.length + 1 : 0);
    if (matches.length) {
      card.classList.add("is-duplicate");
      const warning = document.createElement("div");
      warning.className = "duplicate-warning participant-card__warning";
      warning.setAttribute("role", "text");

      const icon = document.createElement("span");
      icon.className = "duplicate-warning__icon";
      icon.innerHTML = "<svg aria-hidden=\"true\" viewBox=\"0 0 16 16\"><path fill=\"currentColor\" d=\"M8 1.333a6.667 6.667 0 1 0 0 13.334A6.667 6.667 0 0 0 8 1.333Zm0 2a.833.833 0 0 1 .833.834v3.75a.833.833 0 1 1-1.666 0v-3.75A.833.833 0 0 1 8 3.333Zm0 7a1 1 0 1 1 0 2 1 1 0 0 1 0-2Z\"/></svg>";

      const text = document.createElement("span");
      text.className = "duplicate-warning__text";
      const detail = matches
        .map(match => this.describeDuplicateMatch(match, eventId, scheduleId))
        .filter(Boolean)
        .join("、");
      if (duplicateCount > 1) {
        text.textContent = detail
          ? `重複候補 (${duplicateCount}件): ${detail}`
          : `重複候補 (${duplicateCount}件)`;
      } else {
        text.textContent = detail ? `重複候補: ${detail}` : "重複候補があります";
      }

      warning.append(icon, text);
      body.appendChild(warning);
    }

    if (entry.isCancelled) {
      card.classList.add("is-cancelled-origin");
    }
    if (entry.isRelocated) {
      card.classList.add("is-relocated-destination");
    }

    if (changeInfo?.type === "added") {
      card.classList.add("is-added");
    } else if (changeInfo?.type === "updated") {
      card.classList.add("is-updated");
    }

    if (changeInfo) {
      const chip = document.createElement("span");
      chip.className = `change-chip change-chip--${changeInfo.type}`;
      chip.textContent = changeInfo.type === "added" ? "新規" : "更新";
      if (changeInfo.type === "updated" && Array.isArray(changeInfo.changes) && changeInfo.changes.length) {
        chip.title = changeInfo.changes
          .map(change => `${change.label}: ${this.formatChangeValue(change.previous)} → ${this.formatChangeValue(change.current)}`)
          .join("\n");
      }
      nameWrapper.appendChild(chip);
    }

    card.append(header, body);
    return { card, isSelected };
  }

  /**
   * 参加者アクションターゲットの解決
   * @param {Object} options - オプション
   * @param {string} options.participantId - 参加者ID
   * @param {string} options.rowKey - 行キー
   * @param {number} options.rowIndex - 行インデックス
   * @returns {Object} ターゲットオブジェクト（entry, index）
   */
  resolveParticipantActionTarget({ participantId = "", rowKey = "", rowIndex = null } = {}) {
    const normalizedId = String(participantId || "").trim();
    const normalizedRowKey = String(rowKey || "").trim();
    const numericIndex = Number.isInteger(rowIndex) && rowIndex >= 0 ? rowIndex : null;

    let index = -1;
    let entry = null;

    if (normalizedRowKey) {
      index = this.state.participants.findIndex(item => String(item?.rowKey || "") === normalizedRowKey);
      if (index !== -1) {
        entry = this.state.participants[index];
      }
    }

    if (!entry && normalizedId) {
      index = this.state.participants.findIndex(item => String(item?.participantId || "") === normalizedId);
      if (index !== -1) {
        entry = this.state.participants[index];
      }
    }

    if (!entry && numericIndex !== null) {
      const sorted = this.sortParticipants(this.state.participants);
      const candidate = sorted[numericIndex];
      if (candidate) {
        index = this.state.participants.findIndex(item => item === candidate);
        if (index === -1) {
          const candidateRowKey = String(candidate?.rowKey || "");
          if (candidateRowKey) {
            index = this.state.participants.findIndex(item => String(item?.rowKey || "") === candidateRowKey);
          }
        }
        if (index === -1) {
          const candidateId = String(candidate?.participantId || "");
          if (candidateId) {
            index = this.state.participants.findIndex(item => String(item?.participantId || "") === candidateId);
          }
        }
        if (index !== -1) {
          entry = this.state.participants[index];
        }
      }
    }

    return { entry: entry || null, index };
  }

  /**
   * 参加者クイック編集のコミット
   * @param {number} index - インデックス
   * @param {Object} updated - 更新されたエントリ
   * @param {Object} options - オプション
   * @param {string} options.successMessage - 成功メッセージ
   * @param {string} options.successVariant - 成功バリアント
   * @returns {Object|null} 更新されたエントリ
   */
  commitParticipantQuickEdit(index, updated, { successMessage, successVariant = "success" } = {}) {
    if (index < 0 || !updated) {
      return null;
    }

    const nextEntry = this.ensureRowKey({ ...updated });
    const rowKey = String(nextEntry.rowKey || "");
    const uid = this.resolveParticipantUid(nextEntry) || String(nextEntry.participantId || "");

    this.state.participants[index] = nextEntry;
    this.state.participants = this.sortParticipants(this.state.participants);

    const eventId = this.state.selectedEventId;
    const groupNumber = String(nextEntry.groupNumber || "");
    if (eventId && uid) {
      const assignmentMap = this.ensureTeamAssignmentMap(eventId);
      if (assignmentMap) {
        assignmentMap.set(uid, groupNumber);
      }
      const singleMap = new Map([[uid, groupNumber]]);
      this.applyAssignmentsToEventCache(eventId, singleMap);
    }

    this.syncCurrentScheduleCache();
    this.updateDuplicateMatches();
    this.renderParticipants();
    this.syncSaveButtonState();

    if (successMessage) {
      this.setUploadStatus(successMessage, successVariant);
    } else if (this.hasUnsavedChanges()) {
      this.setUploadStatus("編集内容は未保存です。「適用」で確定します。");
    } else {
      this.setUploadStatus("適用済みの内容と同じため変更はありません。");
    }

    if (rowKey) {
      return this.state.participants.find(item => String(item?.rowKey || "") === rowKey) || nextEntry;
    }
    if (uid) {
      return (
        this.state.participants.find(item => {
          const itemUid = this.resolveParticipantUid(item) || String(item?.participantId || "");
          return itemUid === uid;
        }) || nextEntry
      );
    }
    return nextEntry;
  }

  /**
   * クイックキャンセルアクション
   * @param {string} participantId - 参加者ID
   * @param {number} rowIndex - 行インデックス
   * @param {string} rowKey - 行キー
   */
  handleQuickCancelAction(participantId, rowIndex, rowKey) {
    const target = this.resolveParticipantActionTarget({ participantId, rowKey, rowIndex });
    const entry = target.entry;
    const index = target.index;
    if (!entry || index === -1) {
      this.setUploadStatus("キャンセル対象の参加者が見つかりません。", "error");
      return;
    }

    const cancellationLabel = this.CANCEL_LABEL;
    const updated = {
      ...entry,
      groupNumber: cancellationLabel
    };
    const nextStatus = this.resolveParticipantStatus(updated, cancellationLabel);
    updated.status = nextStatus;
    updated.isCancelled = nextStatus === "cancelled";
    updated.isRelocated = nextStatus === "relocated";
    updated.relocationDestinationScheduleId = "";
    updated.relocationDestinationScheduleLabel = "";
    updated.relocationDestinationTeamNumber = "";

    const uid = this.resolveParticipantUid(updated) || String(updated.participantId || "");
    if (uid && this.relocationManager) {
      const relocationMap = this.relocationManager.ensurePendingRelocationMap();
      const previous = relocationMap.get(uid);
      if (previous) {
        this.relocationManager.clearRelocationPreview(previous);
        relocationMap.delete(uid);
      }
    }

    const identifier = this.formatParticipantIdentifier(entry);
    const message = `${identifier}を${this.CANCEL_LABEL}に設定しました。「適用」で確定します。`;
    this.commitParticipantQuickEdit(index, updated, { successMessage: message, successVariant: "success" });

    if (uid && this.relocationManager && Array.isArray(this.state.relocationPromptTargets)) {
      const previousLength = this.state.relocationPromptTargets.length;
      this.state.relocationPromptTargets = this.state.relocationPromptTargets.filter(item => {
        const key = item?.uid || item?.participantId || item?.rowKey;
        return key && key !== uid && key !== String(updated.rowKey || "");
      });
      if (this.state.relocationPromptTargets.length !== previousLength) {
        this.relocationManager.renderRelocationPrompt();
      }
    }

    if (this.relocationManager && this.state.relocationDraftOriginals instanceof Map) {
      const draftMap = this.state.relocationDraftOriginals;
      [uid, String(updated.rowKey || ""), String(updated.participantId || "")]
        .map(value => String(value || "").trim())
        .filter(Boolean)
        .forEach(key => draftMap.delete(key));
    }
  }

  /**
   * 参加者変更キーの生成
   * @param {Object} entry - 参加者エントリ
   * @param {number} fallbackIndex - フォールバックインデックス
   * @returns {string} 変更キー
   */
  participantChangeKey(entry, fallbackIndex = 0) {
    if (!entry) {
      return `__row${fallbackIndex}`;
    }
    const id = entry.participantId ? String(entry.participantId) : "";
    if (id) return id;
    const rowKey = entry.rowKey ? String(entry.rowKey) : "";
    if (rowKey) return rowKey;
    return `__row${fallbackIndex}`;
  }

  /**
   * 変更値のフォーマット
   * @param {*} value - 値
   * @returns {string} フォーマットされた値
   */
  formatChangeValue(value) {
    const text = String(value ?? "").trim();
    return text ? text : "（空欄）";
  }

  /**
   * 変更タイプラベルの取得
   * @param {string} type - 変更タイプ
   * @returns {string} ラベル
   */
  changeTypeLabel(type) {
    switch (type) {
      case "added":
        return "新規追加";
      case "updated":
        return "更新";
      case "removed":
        return "削除予定";
      default:
        return "変更";
    }
  }

  /**
   * 変更用参加者説明の生成
   * @param {Object} entry - 参加者エントリ
   * @returns {string} 説明
   */
  describeParticipantForChange(entry) {
    if (!entry) return "参加者";
    const name = String(entry.name || "").trim();
    const displayId = this.getDisplayParticipantId(entry.participantId);
    if (name && displayId) {
      return `参加者「${name}」（UID: ${displayId}）`;
    }
    if (name) {
      return `参加者「${name}」`;
    }
    if (displayId) {
      return `UID: ${displayId}`;
    }
    return "参加者";
  }

  /**
   * 変更メタの構築
   * @param {Object} entry - 参加者エントリ
   * @returns {string} メタテキスト
   */
  buildChangeMeta(entry) {
    if (!entry) return "";
    const metaParts = [];
    const displayId = this.getDisplayParticipantId(entry.participantId);
    metaParts.push(displayId ? `UID: ${displayId}` : "UID: 未設定");
    const team = String(entry.groupNumber || "").trim();
    if (team) {
      metaParts.push(`班番号: ${team}`);
    }
    const department = String(entry.department || "").trim();
    if (department) {
      metaParts.push(department);
    }
    return metaParts.join(" / ");
  }

  /**
   * 変更プレビューアイテムの作成
   * @param {string} type - 変更タイプ
   * @param {Object} entry - 参加者エントリ
   * @param {Object} info - 変更情報
   * @returns {HTMLElement} アイテム要素
   */
  createChangePreviewItem(type, entry, info = {}) {
    const item = document.createElement("li");
    item.className = `change-preview__item change-preview__item--${type}`;

    const icon = document.createElement("span");
    icon.className = "change-preview__icon";
    icon.innerHTML = this.CHANGE_ICON_SVG[type] || "";
    icon.setAttribute("aria-hidden", "true");
    item.appendChild(icon);

    const body = document.createElement("div");
    body.className = "change-preview__body";

    const heading = document.createElement("p");
    heading.className = "change-preview__line";
    heading.textContent = `${this.changeTypeLabel(type)}: ${this.describeParticipantForChange(entry)}`;
    body.appendChild(heading);

    const metaText = this.buildChangeMeta(entry);
    if (metaText) {
      const meta = document.createElement("p");
      meta.className = "change-preview__line change-preview__line--meta";
      meta.textContent = metaText;
      body.appendChild(meta);
    }

    if (type === "updated" && Array.isArray(info.changes) && info.changes.length) {
      const changeList = document.createElement("ul");
      changeList.className = "change-preview__changes";
      info.changes.forEach(change => {
        const changeItem = document.createElement("li");
        changeItem.className = "change-preview__change";
        changeItem.textContent = `${change.label}: ${this.formatChangeValue(change.previous)} → ${this.formatChangeValue(change.current)}`;
        changeList.appendChild(changeItem);
      });
      body.appendChild(changeList);
    }

    item.appendChild(body);
    return item;
  }

  /**
   * 参加者変更プレビューの描画
   * @param {Object} diff - 差分オブジェクト
   * @param {Map} changeInfoByKey - 変更情報マップ
   * @param {Array} participants - 参加者リスト
   */
  renderParticipantChangePreview(diff, changeInfoByKey, participants = []) {
    if (!this.dom.changePreview || !this.dom.changePreviewList) {
      return;
    }

    const totalChanges = (diff.added?.length || 0) + (diff.updated?.length || 0) + (diff.removed?.length || 0);
    if (!this.hasUnsavedChanges() || totalChanges === 0) {
      this.dom.changePreview.hidden = true;
      this.dom.changePreviewList.innerHTML = "";
      if (this.dom.changePreviewCount) this.dom.changePreviewCount.textContent = "";
      return;
    }

    this.dom.changePreview.hidden = false;

    const summaryParts = [];
    if (diff.updated?.length) summaryParts.push(`更新 ${diff.updated.length}件`);
    if (diff.added?.length) summaryParts.push(`新規 ${diff.added.length}件`);
    if (diff.removed?.length) summaryParts.push(`削除 ${diff.removed.length}件`);
    if (this.dom.changePreviewCount) {
      this.dom.changePreviewCount.textContent = summaryParts.join(" / ");
    }

    const fragment = document.createDocumentFragment();
    const seenKeys = new Set();

    (participants || []).forEach((entry, index) => {
      const key = this.participantChangeKey(entry, index);
      const info = changeInfoByKey.get(key);
      if (!info) return;
      seenKeys.add(key);
      const snapshot = info.current || entry;
      fragment.appendChild(this.createChangePreviewItem(info.type, snapshot, info));
    });

    (diff.removed || []).forEach(entry => {
      const key = this.participantChangeKey(entry);
      if (seenKeys.has(key)) return;
      fragment.appendChild(this.createChangePreviewItem("removed", entry));
    });

    this.dom.changePreviewList.innerHTML = "";
    this.dom.changePreviewList.appendChild(fragment);

    if (this.dom.changePreviewNote) {
      this.dom.changePreviewNote.textContent = "「適用」で変更を確定し、「取消」で破棄できます。";
    }
  }

  /**
   * 参加者カードリストのクリック処理
   * @param {Event} event - クリックイベント
   */
  handleParticipantCardListClick(event) {
    const card = event.target.closest(".participant-card");
    if (card) {
      this.selectParticipantFromCardElement(card);
    }

    const copyButton = event.target.closest(".copy-link-btn");
    if (copyButton) {
      event.preventDefault();
      const token = copyButton.dataset.token;
      this.copyShareLink(token).catch(err => console.error(err));
    }
  }

  /**
   * 参加者カードリストのキーダウン処理
   * @param {KeyboardEvent} event - キーダウンイベント
   */
  handleParticipantCardListKeydown(event) {
    const card = event.target.closest(".participant-card");
    if (!card) {
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      this.selectParticipantFromCardElement(card, { focus: true });
      return;
    }
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      const list = this.dom.participantCardList;
      if (!list) return;
      const cards = Array.from(list.querySelectorAll(".participant-card"));
      const currentIndex = cards.indexOf(card);
      if (currentIndex === -1) return;
      const delta = event.key === "ArrowUp" ? -1 : 1;
      const nextCard = cards[currentIndex + delta];
      if (nextCard) {
        this.selectParticipantFromCardElement(nextCard, { focus: true });
      }
    }
  }

  /**
   * 参加者リストのフォーカス処理
   * @param {FocusEvent} event - フォーカスイベント
   */
  handleParticipantListFocus(event) {
    const card = event.target.closest(".participant-card");
    if (!card) {
      return;
    }
    this.selectParticipantFromCardElement(card);
  }
}

