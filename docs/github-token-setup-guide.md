# GitHub Personal Access Token の設定ガイド

## 概要

GitHub Actions のワークフローファイルをプッシュするには、Personal Access Token に `workflow` スコープが必要です。

## 手順

### 方法 1: Personal Access Tokens (Classic)

1. **GitHub にログイン**
   - https://github.com にアクセス

2. **設定画面へ移動**
   - 画面右上のプロフィールアイコンをクリック
   - ドロップダウンメニューから「**Settings**（設定）」を選択

3. **開発者設定を開く**
   - 左側のサイドバーを下にスクロール
   - 「**Developer settings**（開発者設定）」をクリック

4. **Personal Access Tokens を選択**
   - 「**Personal access tokens**（パーソナルアクセストークン）」をクリック
   - 「**Tokens (classic)**」タブをクリック
     - もし「Tokens (classic)」が見当たらない場合：
       - 「**Fine-grained tokens**」タブが表示されている可能性があります
       - その場合は、方法 2 を参照してください

5. **新しいトークンを生成**
   - 「**Generate new token**（新しいトークンを生成）」をクリック
   - 「**Generate new token (classic)**」を選択

6. **トークンの設定**
   - **Note（ノート）**: トークンの用途を入力（例: "Vite setup workflow"）
   - **Expiration（有効期限）**: 適切な有効期限を設定
   - **Select scopes（スコープを選択）**: 以下のスコープにチェック
     - ✅ **`workflow`** （重要: これがないとワークフローファイルをプッシュできません）
     - ✅ **`repo`** （リポジトリへのアクセスに必要）

7. **トークンを生成**
   - 「**Generate token**（トークンを生成）」をクリック
   - **重要**: 表示されたトークンは一度しか表示されません。必ずコピーして安全な場所に保存してください

8. **Git 認証情報を更新**
   ```bash
   # 次回の git push 時に、ユーザー名とトークンを入力
   # ユーザー名: あなたのGitHubユーザー名
   # パスワード: 生成したトークン（PAT）
   ```

### 方法 2: Fine-grained Personal Access Tokens（新しい方式）

GitHub の新しい Fine-grained Personal Access Tokens を使用する場合：

1. **設定画面へ移動**（方法 1 の手順 1-3 と同じ）

2. **Fine-grained tokens を選択**
   - 「**Personal access tokens**」をクリック
   - 「**Fine-grained tokens**」タブをクリック
   - 「**Generate new token**」をクリック

3. **トークンの設定**
   - **Token name（トークン名）**: トークンの用途を入力
   - **Expiration（有効期限）**: 適切な有効期限を設定
   - **Repository access（リポジトリアクセス）**: 
     - 「**Only select repositories**」を選択
     - 対象のリポジトリを選択

4. **権限を設定**
   - **Repository permissions（リポジトリ権限）**:
     - **Contents**: Read and write
     - **Metadata**: Read-only
   - **Account permissions（アカウント権限）**:
     - **Actions**: Read and write（これが workflow スコープに相当）

5. **トークンを生成**
   - 「**Generate token**」をクリック
   - トークンをコピーして保存

### 方法 3: SSH 認証を使用（推奨）

Personal Access Token の代わりに、SSH 認証を使用する方法：

1. **SSH キーを生成**（まだ持っていない場合）
   ```bash
   ssh-keygen -t ed25519 -C "your_email@example.com"
   ```

2. **SSH キーを GitHub に追加**
   - GitHub → Settings → SSH and GPG keys
   - 「**New SSH key**」をクリック
   - 公開鍵（`~/.ssh/id_ed25519.pub`）の内容をコピーして追加

3. **リモート URL を SSH に変更**
   ```bash
   git remote set-url origin git@github.com:schop-Hirosaki-univcoop/subtitle-output-system.git
   ```

4. **プッシュ**
   ```bash
   git push -u origin feature/vite-setup
   ```

## トラブルシューティング

### 「Tokens (classic)」が見当たらない場合

- GitHub の UI が更新されている可能性があります
- 「**Fine-grained tokens**」タブを確認してください
- または、直接 URL にアクセス: https://github.com/settings/tokens

### トークンを生成してもエラーが出る場合

1. **トークンのスコープを確認**
   - `workflow` スコープが含まれているか確認
   - `repo` スコープも必要です

2. **トークンの有効期限を確認**
   - トークンが期限切れになっていないか確認

3. **Git 認証情報をクリア**
   ```bash
   git credential reject
   # 次回の git push 時に新しい認証情報を入力
   ```

### SSH 認証を使用する場合の注意

- SSH 認証を使用すると、Personal Access Token は不要です
- ただし、GitHub Actions のワークフローファイル自体は、リポジトリにプッシュする必要があります
- SSH 認証を使用しても、ワークフローファイルをプッシュする際に `workflow` スコープが必要な場合があります

## 推奨される方法

**SSH 認証（方法 3）を推奨します**

- Personal Access Token を管理する必要がない
- より安全
- 長期的に使用できる

ただし、既に HTTPS でクローンしている場合は、Personal Access Token を使用する方が簡単です。

---

**作成日**: 2025 年 12 月  
**バージョン**: 1.0.0

