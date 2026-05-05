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
  - 配信予定の場合：配信タイトルと開始時刻を表示（時刻は status-label 部に表示）
  - 配信中の場合：配信タイトルを表示
- 各チャンネルの自動タブオープン ON/OFF トグル（デフォルト：OFF）
- チャンネルの追加（@ハンドル / チャンネルURL / チャンネルID に対応）・削除
- 設定ページへのリンク

### 設定ページ（options）

- ポーリング間隔の設定（デフォルト：5分、範囲：1〜60分）
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
    [channelId]: "active" | "upcoming" | "offline"  // 前回の検知結果
  },
  upcomingInfo: {
    [channelId]: {
      videoId: "VIDEO_ID",        // 配信の動画 ID
      title: "配信タイトル",       // 配信タイトル（取得できない場合は空文字）
      scheduledAt: 1234567890000, // 開始予定時刻（ミリ秒）または null
      alarmSet: false,            // 起動アラームをセット済みか
      tabOpened: false,           // タブを開き済みか（重複防止フラグ）
    }
  }
}
```

- `upcomingInfo` のエントリは upcoming 検知時に作成し、offline 遷移時に削除する
- active 遷移時はエントリを削除せず `tabOpened: true` に更新し、タイトルをポップアップ表示用に保持する（offline 遷移時に削除）
- チャンネル削除時は `liveState` と `upcomingInfo` の対応エントリも同時に削除する

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

### フロー

```
/live ページで upcoming を検知（videoId・scheduledAt 取得）
  ↓
minutesBefore > 0 かつ scheduledAt あり：
  (scheduledAt - minutesBefore) の時刻に chrome.alarms をセット
  ↓
アラーム発火時：おやすみ時間チェック → autoOpen ON のチャンネルのみタブ起動
  tabOpened: true にマーク（active 遷移時の重複オープン防止）
```

### minutesBefore = 0 の場合（デフォルト）

`active` を検知した時点でタブを開く。

### minutesBefore > 0 の場合

`upcoming` 段階でアラームをセット。以下の場合はフォールバックとして `active` 検知時にタブを開く：

- `scheduledAt` が取得できなかった場合
- アラーム発火時刻がすでに過去だった場合（設定変更・拡張インストール遅延など）
- アラームが何らかの理由で発火しなかった場合

フォールバックは `tabOpened` フラグで管理し、アラームで開いた場合は `active` 遷移時に重複オープンしない。

### minutesBefore 変更時

既存の launch アラームをすべてクリアし、`alarmSet: false` にリセットしてから再ポーリング。次のポーリングで新しい時刻のアラームを再設定する。

---

## タイトル・時刻の更新

upcoming 継続中（状態変化なし）でもポーリングのたびに以下を確認し、変更があれば `upcomingInfo` を更新する：

| 変化した項目 | 処理 |
|---|---|
| タイトル | `upcomingInfo.title` を新しい値に更新 |
| 開始時刻 | `upcomingInfo.scheduledAt` を更新 + `alarmSet: false` にリセット |

開始時刻が変わった場合に `alarmSet: false` にリセットすることで、次のポーリングで新しい時刻のアラームが再設定される。

---

## 技術仕様

### Chrome 拡張

- Manifest V3、ES modules（Service Worker・popup ともに `type="module"`）
- Service Worker（`background.js`）でバックグラウンド監視
- `chrome.alarms` で定期起動（最小 1 分間隔）
- `chrome.storage.sync` でチャンネル一覧・設定を保存
- `chrome.storage.local` でライブ状態・upcomingInfo を保存
- `chrome.notifications` でデスクトップ通知
- `chrome.tabs.create()` でタブを自動オープン
- Google Fonts 読み込みのため CSP に `fonts.googleapis.com` / `fonts.gstatic.com` を許可

### YouTube 配信検知

YouTube Data API は使用しない。`youtube.com/channel/CHANNEL_ID/live` を fetch し、レスポンス HTML に埋め込まれた `ytInitialData` をスクレイピングして判定する。

#### videoDetails ブロックの抽出

`/live` ページの HTML には複数の `videoDetails` ブロックが含まれる場合がある（例：メインプレイヤーの通常動画 + 配信予定セクションの upcoming 動画）。単純な先頭一致では誤ったデータを取得するリスクがあるため、以下の手順で判定する：

1. HTML から `"videoDetails":{` を起点に波括弧のネストをカウントし、全 `videoDetails` ブロックを抽出する（文字列内の `{` `}` はスキップ）
2. 各ブロックの `"channelId"` が検索対象チャンネルと一致するものだけを対象にする
3. `"isLive":true` を含むブロックがあれば `active`（即時返却）
4. `"isUpcoming":true` を含むブロックがあれば upcoming 候補として収集し、`scheduledAt`（ページ全体から取得）が最も近い（小さい）ものを採用する

```
全 videoDetails ブロックを抽出
  ↓
channelId が一致するブロックのみ対象
  ↓
isLive:true   → active（即時返却）
isUpcoming:true → upcoming 候補に追加（scheduledAt 最小を優先）
一致なし      → offline
```

#### channelId 検証の意図

`/live` ページには推薦動画や関連動画の `videoDetails` も含まれる。`channelId` チェックなしでは、他チャンネルの配信を誤検知する。

#### scheduledStartTime の取得

`scheduledStartTime` は `videoDetails` ブロックの外に配置される場合があるため、ページ全体（`html.match`）から取得する。

#### チャンネル ID 解決（@ハンドル入力時）

`youtube.com/@handle` をフェッチし、`"externalId":"UC..."` パターンでチャンネル ID を取得する。

#### 状態変化の検知

前回のポーリング結果（`liveState`）と今回の結果を比較し、変化があった場合のみ通知・タブオープン等の処理を行う。

upcoming 継続中（状態変化なし）でも以下を実施する：
- `videoId` が変わった場合：別の配信枠への切り替えとみなしてリセット
- タイトル・時刻が変わった場合：`upcomingInfo` を更新

---

## 監視フロー

```
chrome.alarms 発火（定期ポーリング）
  ↓
登録チャンネル一覧・設定を storage から取得
  ↓
全チャンネルの /live ページを並行 fetch
  ↓
チャンネルごとに前回状態と比較：

┌─ offline → upcoming ─────────────────────────────────────────┐
│  upcomingInfo に登録（videoId・title・scheduledAt）            │
│  notificationEnabled なら通知                                 │
│  minutesBefore > 0 かつ scheduledAt あり：起動アラームをセット │
└──────────────────────────────────────────────────────────────┘

┌─ upcoming 継続（変化なし）────────────────────────────────────┐
│  videoId が変わった → リセットして新しい配信として処理         │
│  タイトル・時刻が変わった → upcomingInfo を更新               │
│  alarmSet: false なら起動アラームの再設定を試みる             │
└──────────────────────────────────────────────────────────────┘

┌─ upcoming → active ───────────────────────────────────────────┐
│  notificationEnabled なら通知                                 │
│  tabOpened: false の場合のみタブ起動（アラーム未発火フォールバック）│
│  launch アラームをクリア                                       │
│  upcomingInfo を active 用に更新（title 保持・tabOpened: true）│
└──────────────────────────────────────────────────────────────┘

┌─ → offline ───────────────────────────────────────────────────┐
│  launch アラームをクリア                                       │
│  upcomingInfo エントリを削除                                   │
└──────────────────────────────────────────────────────────────┘

┌─ launch アラーム発火（N 分前タブ起動）────────────────────────┐
│  おやすみ時間外 かつ autoOpen ON のチャンネルのみタブ起動      │
│  upcomingInfo の tabOpened: true にマーク                     │
└──────────────────────────────────────────────────────────────┘
  ↓
タブ起動対象が複数の場合：
  priorityEnabled OFF → 全対象チャンネルのタブを開く
  priorityEnabled ON  → channels 配列のインデックスが最小の 1 件のみ
  ↓
storage.local に状態を保存
```

---

## 優先順位の仕様

- `priorityEnabled: false`（デフォルト）：`autoOpen: true` のチャンネルはそれぞれ独立してタブを開く
- `priorityEnabled: true`：同一サイクルで複数検知した場合、配列インデックスが最小の 1 件のみタブを開く
- 優先順位は `channels` 配列の並び順で管理（index 0 が最高優先）
- 設定ページでドラッグ＆ドロップにより並び替え可能（`priorityEnabled: true` 時のみ有効）
- ポップアップの一覧表示は常に配列の並び順に従う
- 通知は優先順位・`autoOpen` に関係なく全チャンネル分送る

---

## ファイル構成

```
/
├── manifest.json
├── background.js      # Service Worker：ポーリング・通知・タブ起動
├── popup.html
├── popup.js           # チャンネル一覧・ライブ状態・チャンネルごとON/OFF
├── popup.css
├── options.html
├── options.js         # ポーリング間隔・何分前・通知ON/OFF・おやすみ時間・優先順位
├── options.css
├── utils.js           # 純粋関数（isQuietHours / decodeXml / extractVideoDetailsBlocks など）
├── package.json       # テスト用（vitest）
├── tests/
│   └── utils.test.js  # utils.js の単体テスト（33件）
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

---

## テスト

Vitest を使用。純粋関数を `utils.js` に集約し単体テストする。

```
npm test
```

| テスト対象 | 件数 | 内容 |
|---|---|---|
| `isQuietHours` | 7 | enabled/disabled、日跨ぎ、境界値 |
| `decodeXml` | 6 | 各エンティティ、複合 |
| `extractVideoDetailsBlocks` | 6 | 0/1/2ブロック、文字列内 `{}`、エスケープ、ネスト |
| `selectToOpen` | 4 | priority on/off、空配列 |
| `formatScheduledAt` | 4 | null、今日/明日/その他 |
| `resolveChannelInput` | 6 | ID/URL/ハンドル、fetch 失敗、ID 未発見 |

---

## 将来対応候補

- Twitch 対応（REST API ポーリング）
- ニコニコ生放送対応
- 通知音のカスタマイズ
- Chrome Web Store への公開
