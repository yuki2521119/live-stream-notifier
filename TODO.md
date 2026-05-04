# TODO

実装計画（PLAN.md）に基づくタスク一覧。優先度順。

## Step 1：manifest.json
- [ ] `manifest.json` を作成する

## Step 2：アイコン生成
- [ ] `icons/` ディレクトリを作成する
- [ ] Python スクリプトで `icon16.png`・`icon48.png`・`icon128.png` を生成する

## Step 3：background.js — ストレージ・アラーム基盤
- [ ] `onInstalled` / `onStartup` で `poll` アラームをセットアップする
- [ ] `storage.sync` のデフォルト値を初期化する（channels・settings）
- [ ] `storage.local` のデフォルト値を初期化する（liveState・scheduledLaunches・fallbackChannels）
- [ ] `chrome.alarms.onAlarm` のルーティングを実装する（`poll` vs `launch_*`）

## Step 4：background.js — RSS ポーリング・状態検知
- [ ] `fetchRSS(channelId)` を実装する（fetch → XML テキスト取得）
- [ ] `parseRSSEntry(xmlText)` を実装する（正規表現で videoId・liveBroadcastStatus を抽出）
- [ ] `checkAllChannels()` を実装する（全チャンネルを並行 fetch・状態比較）

## Step 5：background.js — active 検知時の処理
- [ ] `isQuietHours(quietHours)` を実装する（日またぎ対応）
- [ ] `sendNotification(channel)` を実装する（chrome.notifications.create）
- [ ] `openTabs(channels, priorityEnabled)` を実装する（優先順位モード対応）
- [ ] active 検知時の通知・タブ起動ロジックを `checkAllChannels()` に組み込む

## Step 6：popup.html / popup.js / popup.css
- [ ] `popup.html` を作成する（チャンネル一覧・追加フォーム・設定ボタン）
- [ ] `popup.css` を作成する
- [ ] `popup.js` — チャンネル一覧とライブ状態の読み込み・表示を実装する
- [ ] `popup.js` — autoOpen トグルの ON/OFF と storage への保存を実装する
- [ ] `popup.js` — チャンネル追加フォームの送信処理を実装する
- [ ] `popup.js` — チャンネル削除処理を実装する

## Step 7：options.html / options.js / options.css（基本設定）
- [ ] `options.html` を作成する（各設定項目のフォーム）
- [ ] `options.css` を作成する
- [ ] `options.js` — 設定値の読み込みとフォームへの反映を実装する
- [ ] `options.js` — 保存ボタン押下時に storage へ書き込む処理を実装する
- [ ] `options.js` — ポーリング間隔変更時に background へメッセージを送信する処理を実装する

## Step 8：background.js — upcoming 検知・N 分前アラーム
- [ ] `fetchScheduledStartTime(videoId)` を実装する（ytInitialData スクレイピング）
- [ ] upcoming 検知時のアラームセット処理を実装する（重複防止・失敗時フォールバック）
- [ ] `launch_*` アラーム発火時のタブ起動処理を実装する

## Step 9：options.js — ドラッグ＆ドロップ優先順位
- [ ] `options.html` にチャンネル並び替えリストを追加する
- [ ] HTML5 DnD でドラッグ＆ドロップによる並び替えを実装する
- [ ] `priorityEnabled` トグルに連動してハンドルを表示・非表示にする
- [ ] 保存時にチャンネル配列の並び順を storage に反映する
