# Code Review

## 使い方 / How to Read This Document

このファイルは、提出されたコードに対するコードレビューのメモをまとめたものです。以下のように活用してください。

1. **Summary（概要）** – 何のレビューなのかをひとことで把握します。
2. **Findings（指摘事項）** – 問題点や改善提案を 1 つずつ列挙しています。各見出しの本文を読み、該当箇所を修正してください。
3. **Diff 提案** – 具体的な修正方法がある場合は ` ```diff ` ブロックで例を示しています。そのまま適用するか、必要に応じてアレンジしてください。下の「Diff の適用方法」節も参照してください。
4. **Suggestions（任意改善案）** – 余裕があれば検討してほしい改善アイデアです。

Pull Request などでレビュー内容を共有する場合は、このファイルを参照しながら修正を行い、対応状況をコメントするとスムーズです。

### どこに保存されているの？ / Where is this file stored?

- **リポジトリ直下に保存**されています。ローカル環境では `subtitle-output-system/CODE_REVIEW.md` というパスで開けます。
- GitHub 上でも、リポジトリを push すればファイルツリーから直接閲覧できます（例: `https://github.com/<your-org-or-user>/subtitle-output-system/blob/<branch>/CODE_REVIEW.md`）。
- まだ GitHub に push していない場合は、ローカルの Git クライアントや VS Code などで開く必要があります。

### Diff の適用方法 / How to apply the suggested diffs

レビュー内に掲載した ` ```diff ` ブロックは、以下のように適用できます。

1. **コマンドラインで適用する場合**
   1. diff ブロックをそのままコピーして、`patch.diff` など任意のファイル名で保存します。
   2. プロジェクトのルート（例: `subtitle-output-system/`）で以下を実行します。

      ```bash
      git apply patch.diff
      ```

      *既に該当箇所に変更がある場合はコンフリクトになるので、そのときは手動で差分を反映してください。*

2. **VS Code などのエディタで手動適用する場合**
   - diff を参考にしながら、各ファイルを開いて該当箇所を編集します。
   - 赤い行（`-` から始まる行）を削除し、緑の行（`+` から始まる行）を追加するイメージです。

3. **GitHub UI で適用する場合**
   - Pull Request の画面から「Apply suggestion」ボタンが使える形式のコメントであれば、ワンクリックで取り込めます。
   - それ以外の場合は、ブラウザ上のエディタで該当ファイルを開き、手動で編集してください。

適用後は `git status` で変更内容を確認し、テスト実行やレビューの指摘チェックを行ってからコミット & push する流れが一般的です。

## Summary
- Review of the latest `display.html`, `operator.js`, `style.css`, and supporting Apps Script (`code.gs`) against the current Firebase security rules and the `render_state` permission errors reported in the browser console.

## Findings

### 1. `render_state` writes ignore the `/screens/approved` gate (display.html)
Firebase rules only allow anonymous users whose UID is whitelisted under `/screens/approved/{uid}` to update `render_state`, yet `reportRender()` is invoked immediately after the app starts. Until the approval entry exists, every call fails with `PERMISSION_DENIED`, spamming the console and wasting retries. Gate the writes until both anonymous auth has completed *and* the device is approved.

```diff
diff --git a/display.html b/display.html
--- a/display.html
+++ b/display.html
@@
-import { getDatabase, ref, onValue, update, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
+import { getDatabase, ref, onValue, update, serverTimestamp, get } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
@@
-const renderRef = ref(database, 'render_state');
+const renderRef = ref(database, 'render_state');
+let canReportRender = false;
+let approvalChecked = false;
 
-onAuthStateChanged(auth, (user) => {
-  if (!user) {
-    signInAnonymously(auth).catch(err => {
-      console.error('Anonymous sign-in failed:', err);
-    });
-  }
-});
+onAuthStateChanged(auth, async (user) => {
+  if (!user) {
+    signInAnonymously(auth).catch(err => {
+      console.error('Anonymous sign-in failed:', err);
+    });
+    return;
+  }
+
+  try {
+    const approvedSnap = await get(ref(database, `screens/approved/${user.uid}`));
+    canReportRender = approvedSnap.exists() && approvedSnap.val() === true;
+    approvalChecked = true;
+    if (!canReportRender) {
+      console.warn('Display UID is not approved; suppressing render_state updates.');
+    }
+  } catch (err) {
+    approvalChecked = true;
+    canReportRender = false;
+    console.error('Failed to confirm display approval status:', err);
+  }
+});
@@
-function reportRender(phase, info = {}) {
-  const payload = {
-    phase,                                        // 'showing' | 'visible' | 'hiding' | 'hidden' | 'error'
-    updatedAt: serverTimestamp(),
-    ...info                                       // { name, uid, seq など任意}
-  };
-  update(renderRef, payload).catch(console.error);
+function reportRender(phase, info = {}) {
+  if (!canReportRender) {
+    if (approvalChecked) {
+      console.debug('render_state update skipped because this device is not approved.');
+    }
+    return Promise.resolve();
+  }
+
+  const payload = {
+    phase,                                        // 'showing' | 'visible' | 'hiding' | 'hidden' | 'error'
+    updatedAt: serverTimestamp(),
+    ...info                                       // { name, uid, seq など任意}
+  };
+  return update(renderRef, payload).catch(console.error);
 }
```

### 2. `updateAnswerStatus` / `batchUpdateStatus` write whatever comes from the client (code.gs)
Both functions persist the raw `status` argument into the "回答済" column. Because the operator UI sends the string values "true"/"false", the sheet stores text instead of booleans, and `mirrorSheetToRtdb_()` later collapses the value back to `false`. Coerce the input once before writing so that RTDB mirrors remain stable.

```diff
diff --git a/code.gs b/code.gs
--- a/code.gs
+++ b/code.gs
@@
-function updateAnswerStatus(uid, status) {
+function updateAnswerStatus(uid, status) {
   const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('answer');
@@
-      sheet.getRange(i + 1, answeredColIndex + 1).setValue(status);
+      const isAnswered = status === true || status === 'true' || status === 1;
+      sheet.getRange(i + 1, answeredColIndex + 1).setValue(isAnswered);
@@
-function batchUpdateStatus(uids, status) {
+function batchUpdateStatus(uids, status) {
@@
-    for (let i = 1; i < data.length; i++) {
-    if (uidSet.has(String(data[i][uidColIndex]))) {
-        sheet.getRange(i + 1, answeredColIndex + 1).setValue(status);
-      }
-    }
+    const isAnswered = status === true || status === 'true' || status === 1;
+    for (let i = 1; i < data.length; i++) {
+      if (uidSet.has(String(data[i][uidColIndex]))) {
+        sheet.getRange(i + 1, answeredColIndex + 1).setValue(isAnswered);
+      }
+    }
```

### 3. `updateSelectingStatus` still toggles rows one-by-one (code.gs)
Clearing every "選択中" cell with `setValue(false)` inside the loop makes as many API calls as there are rows, firing `notifyUpdate()` repeatedly. Build a single 2D array and call `setValues()` once, just as `clearSelectingStatus()` does.

```diff
diff --git a/code.gs b/code.gs
--- a/code.gs
+++ b/code.gs
@@
-  for (let i = 1; i < data.length; i++) {
-    if (sheet.getRange(i + 1, selectingColIndex + 1).getValue() === true) {
-      sheet.getRange(i + 1, selectingColIndex + 1).setValue(false);
-    }
-  }
+  const numRows = data.length - 1;
+  if (numRows > 0) {
+    const selectingRange = sheet.getRange(2, selectingColIndex + 1, numRows, 1);
+    const cleared = Array.from({ length: numRows }, () => [false]);
+    selectingRange.setValues(cleared);
+  }
```

### 4. `clearSelectingStatus` sometimes returns a `TextOutput` (code.gs)
When the sheet has only the header row, the function returns a `ContentService.TextOutput`, but `doPost()` expects a plain object and wraps it with `jsonOk`. Always return a simple object instead of alternating types.

```diff
diff --git a/code.gs b/code.gs
--- a/code.gs
+++ b/code.gs
@@
-    if (numRows <= 0) {
-      return ContentService.createTextOutput(JSON.stringify({ success: true }))
-        .setMimeType(ContentService.MimeType.JSON);
-    }
+    if (numRows <= 0) {
+      return { success: true };
+    }
@@
-    return { success: true };
+    return { success: true };
   } catch (error) {
```

### 5. Allow-list domain comparison is case-sensitive (code.gs)
`requireAuth_()` compares `allowed.includes(domain)` without normalising either side. Firebase can report uppercase letters in `user.email`, which would incorrectly reject legitimate users. Lower-case both values first.

```diff
diff --git a/code.gs b/code.gs
--- a/code.gs
+++ b/code.gs
@@
-  const allowed = getAllowedDomains_(); // 例：['example.ac.jp', 'another.edu']
-  if (allowed.length && email) {
-    const domain = String(email).split('@')[1] || '';
-    if (!allowed.includes(domain)) throw new Error('Unauthorized domain');
-  }
+  const allowed = getAllowedDomains_().map(d => String(d).toLowerCase());
+  if (allowed.length && email) {
+    const domain = String(email).split('@')[1] || '';
+    if (!allowed.includes(domain.toLowerCase())) throw new Error('Unauthorized domain');
+  }
```

### 6. Operator client re-check should normalise emails (operator.js)
After fetching the `users` sheet, the operator UI does `authorizedUsers.includes(user.email)`. If the sheet stores lower-case addresses but Firebase returns mixed-case variants (quite common), the operator will be kicked back to the login view even though GAS would allow the same user. Mirror the lower-casing that the backend already expects.

```diff
diff --git a/operator.js b/operator.js
--- a/operator.js
+++ b/operator.js
@@
-      if (result.success && result.data) {
-        const authorizedUsers = result.data.map(item => item['メールアドレス']);
-　　　　if (authorizedUsers.includes(user.email)) {
+      if (result.success && result.data) {
+        const authorizedUsers = result.data
+          .map(item => String(item['メールアドレス'] || '').trim().toLowerCase())
+          .filter(Boolean);
+        const loginEmail = String(user.email || '').trim().toLowerCase();
+        if (authorizedUsers.includes(loginEmail)) {
```

## Suggestions
- Once the critical fixes above are in place, consider extracting the shared sheet-column lookups in `code.gs` into helper functions to reduce duplication between single and batch status updates.
- In `display.html`, you may want to surface a dedicated banner when `canReportRender` is false so operators immediately know the device must be approved.
