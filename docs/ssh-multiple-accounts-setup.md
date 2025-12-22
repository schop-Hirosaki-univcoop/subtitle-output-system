# 複数 GitHub アカウント用 SSH キーの設定

## 概要

既に別の GitHub アカウントで SSH キーを使用している場合、このリポジトリ用に専用の SSH キーを作成し、SSH 設定で管理します。

## 完了した作業

✅ 新しい SSH キーを作成: `~/.ssh/id_ed25519_subtitle`
✅ SSH 設定ファイルに設定を追加: `~/.ssh/config`

## 次のステップ

### ステップ 1: 新しい SSH 公開鍵を GitHub に追加

以下の公開鍵をコピーしてください：

```
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAILDoEAXtgBjEqbNL7/ZoALm/QE02eJqdcQOuJKLvMyH8 subtitle-output-system
```

**追加手順：**

1. **GitHub にログイン**

   - このリポジトリ（schop-Hirosaki-univcoop/subtitle-output-system）にアクセス権限があるアカウントでログイン

2. **Settings を開く**

   - https://github.com/settings/keys

3. **新しい SSH キーを追加**
   - 「**New SSH key**」をクリック
   - **Title**: "subtitle-output-system" など識別しやすい名前
   - **Key**: 上記の公開鍵を貼り付け
   - **Key type**: "Authentication Key" を選択
   - 「**Add SSH key**」をクリック

### ステップ 2: SSH 接続をテスト

```bash
ssh -T git@github-subtitle
```

成功すると、以下のようなメッセージが表示されます：

```
Hi [username]! You've successfully authenticated, but GitHub does not provide shell access.
```

### ステップ 3: プッシュを試す

```bash
cd /Users/maruokyohei/subtitle-output-system/subtitle-output-system-1
git push -u origin feature/vite-setup
```

## SSH 設定の説明

`~/.ssh/config` に以下の設定を追加しました：

```
Host github-subtitle
    HostName github.com
    User git
    IdentityFile ~/.ssh/id_ed25519_subtitle
    IdentitiesOnly yes
```

この設定により：

- `git@github-subtitle` を使用すると、専用の SSH キー（`id_ed25519_subtitle`）が使用されます
- 他の GitHub リポジトリでは、既存の SSH キーが使用されます
- `IdentitiesOnly yes` により、指定したキーのみが使用されます

## トラブルシューティング

### 「Permission denied」エラーが出る場合

1. **SSH キーが正しく追加されているか確認**

   ```bash
   ssh -T git@github-subtitle
   ```

2. **リモート URL が正しいか確認**

   ```bash
   git remote -v
   ```

   - `git@github-subtitle:schop-Hirosaki-univcoop/subtitle-output-system.git` になっていることを確認

3. **SSH キーが正しく読み込まれているか確認**
   ```bash
   ssh-add ~/.ssh/id_ed25519_subtitle
   ssh-add -l
   ```

### 別のアカウントのリポジトリにアクセスする場合

既存の SSH キーを使用する場合は、通常の `git@github.com` を使用してください。

---

**作成日**: 2025 年 12 月  
**バージョン**: 1.0.0
