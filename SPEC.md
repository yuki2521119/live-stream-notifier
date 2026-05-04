# 仕様書

## 概要

指定した YouTube チャンネルのライブ配信開始を検知し、自動でブラウザタブを開く Chrome 拡張。

---

## 対応プラットフォーム

- YouTube（現時点）

---

## 機能

### コア機能

- 登録チャンネルのライブ配信をバックグラウンドで定期監視
- 配信開始を検知したらデスクトップ通知を表示（ON/OFF 可）
- 配信開始の N 分前に自動でタブを開く（チャンネルごとに ON/OFF 可）
- 自動起動しない時間帯（おやすみ時間）を設定可能

### ポップアップ

- 監視中のチャンネル一覧を表示
- 各チャンネルのライブ状態（配信中 / 配信予定 / オフライン）を表示
- 配信予定チャンネルは配信タイトルと開始時刻をあわせて表示
- 各チャンネルの自動タブオープン ON/OFF トグル（デフォルト：OFF）
- チャンネルの追加（@ハンドル / チャンネルURL / チャンネルID に対応）・削除
- 設定ページへのリンク

### 設定ページ（options）

- ポーリング間隔の設定（デフォルト：5分）
- 自動タブオープンの何分前に起動するか（デフォルト：0分、範囲：0〜60分）
- デスクトップ通知の ON/OFF（デフォルト：ON）
- おやすみ時間の設定（開始時刻・終了時刻）
- チャンネルの優先順位設定（ドラッグ＆ドロップで並び替え、ON/OFF 可）

---

## チャンネルのデータ構造

```js
// storage.sync に保存
{
  id: "UCxxxxxx",      // YouTube チャンネル ID
  name: "チャンネル名",
  autoOpen: false,     // 自動タブオープン ON/OFF（デフォルト：OFF）
}
```

優先順位は `channels` 配列のインデックス順で表す（index 0 が最高優先）。順序は設定ページのドラッグ＆ドロップで変更する。

---

## 設定のデータ構造

```js
// storage.sync に保存
{
  intervalMinutes: 5,        // ポーリング間隔（分）
  minutesBefore: 0,          // 配信開始の何分前にタブを開くか
  notificationEnabled: true, // デスクトップ通知 ON/OFF
  priorityEnabled: false,    // 優先順位モード ON/OFF（デフォルト：OFF）
  quietHours: {
    enabled: false,          // おやすみ時間 ON/OFF
    start: "23:00",          // 開始時刻（HH:MM）
    end: "07:00",            // 終了時刻（HH:MM）
  }
}
```

---

## ローカルストレージのデータ構造

```js
// storage.local に保存
{
  liveState: {
    [channelId]: "active" | "upcoming" | "offline"   // 前回の検知結果
  },
  upcomingInfo: {
    [channelId]: {
      videoId: "VIDEO_ID",       // 配信の動画ID
      title: "配信タイトル",      // 配信タイトル（取得できない場合は空文字）
      scheduledAt: 1234567890000, // 開始予定時刻（ミリ秒） または null
      alarmSet: false             // 起動アラームをセット済みか
    }
  }
}
```

チャンネル削除時は `liveState` と `upcomingInfo` の対応エントリも同時に削除する。

---

## おやすみ時間の仕様

- 設定した時間帯は自動タブオープンを実行しない
- デスクトップ通知はおやすみ時間中も送る（通知は別途 ON/OFF で制御）
- 日をまたぐ範囲に対応（例：23:00〜07:00）
- おやすみ時間中に配信開始を検知した場合、タブオープンはスキップする（リトライなし）

```
現在時刻が おやすみ時間内か判定
  ↓
23:00〜07:00 の場合：start > end なら日またぎとして処理
  ├─ 現在時刻 >= start または 現在時刻 < end → おやすみ時間内
  └─ それ以外 → 通常時間
```

---

## 「N 分前に起動」の実装方針

`/channel/CHANNEL_ID/live` のページには `scheduledStartTime` が含まれるため、同じリクエストで開始予定時刻を取得できる。

### フロー

```
/live ページで upcoming を検知（videoId・scheduledStartTime 取得）
  ↓
(scheduledStartTime - minutesBefore) の時刻に chrome.alarms をセット
  ↓
アラーム発火時：おやすみ時間チェック → 通常時間なら autoOpen ON のチャンネルのみタブ起動
```

### minutesBefore = 0 の場合（デフォルト）

`active` を検知した時点でタブを開く。

### minutesBefore > 0 の場合

`upcoming` 段階でアラームをセット。`scheduledStartTime` が取得できなかった場合は `active` 検知時にフォールバック。

---

## 技術仕様

### Chrome 拡張

- Manifest V3
- Service Worker（`background.js`）でバックグラウンド監視
- `chrome.alarms` で定期起動（最小 1 分間隔）
- `chrome.storage.sync` でチャンネル一覧・設定を保存
- `chrome.storage.local` でライブ状態・upcomingInfo を保存
- `chrome.notifications` でデスクトップ通知
- `chrome.tabs.create()` でタブを自動オープン

### YouTube 配信検知

RSS フィードには `liveBroadcastStatus` が含まれないため使用しない。代わりに `youtube.com/channel/CHANNEL_ID/live` を fetch して判定する。このURLはYouTubeが「最も直近のライブ・配信予定」を返す特殊URLで、複数の枠が存在する場合も自動的に最直近の1件を返す。

#### ライブ状態の判定ロジック

```
html に "isUpcoming":true が含まれる → upcoming（配信予定）
  ↓ 含まれない
html に "isLive":true が含まれる     → active（配信中）
  ↓ 含まれない
                                       offline
```

`"isUpcoming":true` を先にチェックすることで、ウェイティングルームを `active` と誤判定しない。

#### videoId・タイトルの取得

ytInitialData 内の `videoDetails` から `"videoId":"...","title":"..."` のパターンでペアとして取得する。単独の `"videoId":"..."` は関係ないチャンネルのIDを拾うリスクがあるため使用しない。

```javascript
const detailsMatch = html.match(/"videoId":"([a-zA-Z0-9_-]{11})","title":"((?:[^"\\]|\\.)*)"/);
// detailsMatch[1] → videoId
// detailsMatch[2] → title
```

#### チャンネルID解決（@ハンドル入力時）

`youtube.com/@handle` をフェッチし、`"externalId":"UC..."` パターンでチャンネルID を取得する。`"channelId"` はページ内に複数回出現し関連チャンネルのIDを拾うリスクがあるため使用しない。

### manifest.json の主要設定

```json
{
  "manifest_version": 3,
  "permissions": ["notifications", "tabs", "storage", "alarms"],
  "host_permissions": ["https://www.youtube.com/*"],
  "background": { "service_worker": "background.js" }
}
```

---

## ファイル構成

```
/
├── manifest.json
├── background.js     # Service Worker：ポーリング・通知・タブ起動
├── popup.html
├── popup.js          # チャンネル一覧・ライブ状態・チャンネルごとON/OFF
├── popup.css
├── options.html
├── options.js        # ポーリング間隔・何分前・通知ON/OFF・おやすみ時間・優先順位並び替え
├── options.css
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

---

## 監視フロー

```
chrome.alarms 発火（定期）
  ↓
登録チャンネル一覧・設定を storage から取得
  ↓
全チャンネルの /live ページを並行 fetch
  ↓
┌─ active を検知（前回から状態変化あり）──────────────────────┐
│  ├─ notificationEnabled なら通知（全チャンネル）             │
│  └─ minutesBefore = 0 の場合：                              │
│     新たに active になった autoOpen ON チャンネルを収集      │
│     おやすみ時間外の場合のみ：                              │
│     ├─ priorityEnabled OFF → 収集した全チャンネルのタブを開く│
│     └─ priorityEnabled ON  → 配列インデックス最小の1件のみ  │
└─────────────────────────────────────────────────────────────┘
┌─ upcoming を検知（前回から状態変化あり）─────────────────────┐
│  upcomingInfo に登録（videoId・title・scheduledAt）          │
│  minutesBefore > 0 かつ scheduledAt あり：起動アラームをセット│
└─────────────────────────────────────────────────────────────┘
┌─ upcoming 継続中（状態変化なし）────────────────────────────┐
│  title が未取得の場合のみ upcomingInfo.title を更新          │
└─────────────────────────────────────────────────────────────┘
┌─ アラーム発火（予約済みタブ起動）───────────────────────────┐
│  おやすみ時間外の場合のみ：                                 │
│  ├─ priorityEnabled OFF → autoOpen ON の全チャンネルを開く  │
│  └─ priorityEnabled ON  → autoOpen ON のうち最上位の1件のみ │
└─────────────────────────────────────────────────────────────┘
  ↓
状態を storage.local に保存
```

---

## 優先順位の仕様

- `priorityEnabled: false`（デフォルト）：`autoOpen: true` のチャンネルはそれぞれ独立してタブを開く
- `priorityEnabled: true`：同一サイクルで複数検知した場合、配列インデックスが最小の1件のみタブを開く
- 優先順位は `channels` 配列の並び順で管理（index 0 が最高優先）
- 設定ページでドラッグ＆ドロップにより並び替え可能（`priorityEnabled: true` 時のみ有効）
- ポップアップの一覧表示は常に配列の並び順に従う
- 通知は優先順位・`autoOpen` に関係なく全チャンネル分送る

---

## 将来対応候補

- Twitch 対応（REST API ポーリング）
- ニコニコ生放送対応
- 通知音のカスタマイズ
- Chrome Web Store への公開
