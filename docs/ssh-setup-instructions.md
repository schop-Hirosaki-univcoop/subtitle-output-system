# SSH 認証の設定手順

## 現在の状況

SSH キーは既に存在していますが、このリポジトリへのアクセス権限がない可能性があります。

## 解決手順

### ステップ 1: SSH 公開鍵をコピー

以下のコマンドで公開鍵をコピーしてください：

```bash
cat ~/.ssh/id_ed25519.pub
```

または、クリップボードにコピー：

```bash
cat ~/.ssh/id_ed25519.pub | pbcopy
```

### ステップ 2: GitHub に SSH キーを追加

1. **GitHub にログイン**

   - https://github.com にアクセス

2. **Settings を開く**

   - 右上のプロフィールアイコンをクリック
   - 「**Settings**（設定）」を選択

3. **SSH and GPG keys を開く**

   - 左側のサイドバーで「**SSH and GPG keys**」をクリック
   - または直接 URL: https://github.com/settings/keys

4. **新しい SSH キーを追加**

   - 「**New SSH key**」ボタンをクリック
   - **Title（タイトル）**: キーの識別名を入力（例: "MacBook Pro"）
   - **Key（キー）**: ステップ 1 でコピーした公開鍵を貼り付け
   - **Key type（キータイプ）**: "Authentication Key" を選択
   - 「**Add SSH key**」をクリック

5. **確認**
   - パスワードを入力して確認

### ステップ 3: アクセス権限を確認

リポジトリへのアクセス権限があるか確認してください：

1. **リポジトリの設定を確認**

   - https://github.com/schop-Hirosaki-univcoop/subtitle-output-system
   - Settings → Collaborators で、あなたのアカウントが追加されているか確認

2. **組織のメンバーシップを確認**
   - 組織（schop-Hirosaki-univcoop）のメンバーであることを確認

### ステップ 4: 再度プッシュを試す

```bash
cd /Users/maruokyohei/subtitle-output-system/subtitle-output-system-1
git push -u origin feature/vite-setup
```

## トラブルシューティング

### 「Permission denied」エラーが出る場合

1. **SSH キーが正しく追加されているか確認**

   ```bash
   ssh -T git@github.com
   ```

   - 成功メッセージが表示されることを確認

2. **リポジトリへのアクセス権限を確認**

   - リポジトリの所有者または管理者に確認
   - 組織のメンバーシップを確認

3. **別の SSH キーを使用している可能性**
   ```bash
   ssh-add -l
   ```
   - 登録されている SSH キーを確認
   - 必要に応じて、正しいキーを追加:
     ```bash
     ssh-add ~/.ssh/id_ed25519
     ```

### Deploy key として登録されている場合

Deploy key は読み取り専用です。書き込み権限が必要な場合は、通常の SSH キーとして追加する必要があります。

---

**作成日**: 2025 年 12 月  
**バージョン**: 1.0.0
