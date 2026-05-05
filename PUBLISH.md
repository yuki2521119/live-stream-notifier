# Chrome Web Store 公開手順

## ステップ一覧

| # | 作業 | 状況 |
|---|---|---|
| 1 | Google デベロッパーアカウント登録 | ❌ |
| 2 | ストア掲載用素材の作成 | 一部完了 |
| 3 | プライバシーポリシーの公開 | ❌ |
| 4 | ストア掲載テキストの作成 | ❌ |
| 5 | 提出用 ZIP の作成 | ❌ |

---

## 1. Google デベロッパーアカウント登録

- URL: https://chrome.google.com/webstore/devconsole
- 登録料: **$5（一回のみ）**
- Google アカウントでログインして支払い

---

## 2. ストア掲載用素材

### アイコン
| サイズ | 状況 |
|---|---|
| 128x128 | ✅ `icons/icon128.png` |
| 48x48 | ✅ `icons/icon48.png` |
| 16x16 | ✅ `icons/icon16.png` |

### スクリーンショット（必須・最低1枚）
- サイズ: **1280x800** または **640x400**
- ポップアップ・設定画面などを撮影

### プロモーション画像（任意）
| 種類 | サイズ |
|---|---|
| 小バナー | 440x280 |
| 大バナー | 920x680 |
| マーキー | 1400x560 |

---

## 3. プライバシーポリシー

審査で必須。外部へのデータ送信がない旨を記載する。

**記載すべき内容:**
- 収集する情報: なし（チャンネル設定は Chrome ストレージにのみ保存）
- 外部送信: なし
- YouTube へのアクセス: ユーザーが登録したチャンネルの配信状況確認のみ

**公開方法の例:**
- GitHub Pages（リポジトリの `docs/` ディレクトリ）
- Notion / Google Sites など

---

## 4. ストア掲載テキスト

### 短い説明（132文字以内）
```
YouTube チャンネルの配信開始を自動検知し、指定時間にタブを開く Chrome 拡張。複数チャンネルの監視・通知・N分前起動に対応。
```

### カテゴリ
`生産性` または `ツール`

### 詳細説明（案）
```
LiveStream Notifier は、登録した YouTube チャンネルのライブ配信を
バックグラウンドで自動監視する Chrome 拡張機能です。

【主な機能】
・複数チャンネルの配信状態をリアルタイム監視
・配信開始時にデスクトップ通知
・配信開始の N 分前に自動でタブを開く
・チャンネルごとに自動起動の ON/OFF を設定可能
・おやすみ時間の設定（指定時間帯は自動起動しない）
・複数チャンネル同時配信時の優先順位設定

【対応入力形式】
@ハンドル / チャンネルURL / チャンネルID
```

---

## 5. 提出用 ZIP の作成

開発用ファイルを除いた拡張機能本体だけを ZIP にする。

### 含めるファイル
```
manifest.json
background.js
utils.js
popup.html
popup.js
popup.css
options.html
options.js
options.css
icons/
  icon16.png
  icon48.png
  icon128.png
```

### 除外するファイル
```
node_modules/
tests/
package.json
package-lock.json
.gitignore
.claude/
SPEC.md
PUBLISH.md
README.md
RESEARCH.md
TODO.md
```

### ZIP 作成コマンド
```bash
zip -r live_stream_notifier.zip \
  manifest.json background.js utils.js \
  popup.html popup.js popup.css \
  options.html options.js options.css \
  icons/
```

---

## 6. 審査・公開

1. Developer Dashboard で「新しいアイテムを追加」
2. ZIP をアップロード
3. 素材・テキスト・プライバシーポリシー URL を入力
4. 各パーミッションの用途を説明欄に記載（下記参照）
5. 審査に提出 → 通常 **1〜3 営業日**で結果通知

### パーミッションの用途説明

| パーミッション | 用途 |
|---|---|
| `notifications` | 配信開始・配信予定を検知した際のデスクトップ通知 |
| `tabs` | 配信開始時に YouTube のタブを自動で開く |
| `storage` | チャンネル一覧・設定の保存（ローカルのみ） |
| `alarms` | 定期ポーリングおよびN分前タブ起動のスケジュール管理 |

---

## 注意事項

- スクレイピング方式のため、YouTube の HTML 構造変更により突然動作しなくなる可能性がある
- YouTube Data API は使用していない（APIキー不要・クォータ制限なし）
- ユーザーデータの外部送信は一切なし
