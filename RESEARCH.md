# 調査メモ

## 既存の類似サービス

| 名前 | プラットフォーム | 自動タブ開く | 備考 |
|---|---|---|---|
| [Twitch Auto Open](https://chromewebstore.google.com/detail/twitch-auto-open/cnaldclkgjcdiflplmabgoogecemnffn) | Twitch のみ | ✅ | 同コンセプト・Twitch限定 |
| [NowStreaming - Twitch](https://chromewebstore.google.com/detail/nowstreaming-twitch/cfdokgjlnihoblidldhdomakblbaegim) | Twitch のみ | 通知のみ | フォロー中のストリーマー管理 |
| [Twitch Live Extension](https://chromewebstore.google.com/detail/twitch-live-extension/nlnfdlnihoblidldhdomakblbaegim) | Twitch のみ | ❌ | 通知のみ |

**YouTube + 自動タブオープンに対応した拡張は存在しない。**

---

## YouTube 配信検知：RSS vs API の比較

| 方法 | APIキー | コスト | 備考 |
|---|---|---|---|
| **RSS フィード** | 不要 | 無料・無制限 | `<media:liveBroadcastStatus>active</media:liveBroadcastStatus>` で判定 |
| YouTube Data API v3 (`search.list`) | 必要 | 100 units/回、上限 10,000/日 | 5分ポーリングで1チャンネルでも quota 超過 |

→ RSS フィード一択。

---

## YouTube RSS フィードの仕様

### フィード URL

```
https://www.youtube.com/feeds/videos.xml?channel_id=CHANNEL_ID
```

### `media:liveBroadcastStatus` の値（※実測で使用不可と判明）

| 値 | 意味 |
|---|---|
| `active` | 現在ライブ中 |
| `upcoming` | 配信予定（スケジュール済み） |
| `completed` | 配信終了（アーカイブ） |
| タグなし | 通常の動画 |

> ⚠️ **実測で判明した問題**：実際の YouTube RSS フィードには `media:liveBroadcastStatus` タグが含まれないケースが多く、ライブ検知に使えないことを 2026-05-04 に確認。RSS アプローチを廃止。

### 代替手法：`/channel/CHANNEL_ID/live` ページスクレイピング（採用）

`https://www.youtube.com/channel/CHANNEL_ID/live` を fetch して判定：
- `"isLive":true` → 配信中（active）
- `"scheduledStartTime":"TIMESTAMP"` → 配信予定（upcoming）・開始時刻も同時取得可能

### 制約

- 取得できるエントリ数：最新 **15件のみ**
- YouTube 側の更新頻度：**1〜5分ごと**（最大5分の検知遅延）
- ゲリラ配信（事前スケジュールなし）も `active` で検知可能

### XML 構造

```xml
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015"
      xmlns:media="http://search.yahoo.com/mrss/">
  <entry>
    <yt:videoId>VIDEO_ID</yt:videoId>
    <title>配信タイトル</title>
    <link href="https://www.youtube.com/watch?v=VIDEO_ID"/>
    <media:liveBroadcastStatus>active</media:liveBroadcastStatus>
  </entry>
</feed>
```

### Service Worker での XML 解析

Manifest V3 の Service Worker は `DOMParser` が使えないため、正規表現で解析する。

```javascript
function extractLiveUrl(xmlText) {
  const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
  let match;
  while ((match = entryRegex.exec(xmlText)) !== null) {
    const entry = match[1];
    if (/<media:liveBroadcastStatus>active<\/media:liveBroadcastStatus>/.test(entry)) {
      const videoId = entry.match(/<yt:videoId>(.+?)<\/yt:videoId>/)?.[1];
      return videoId ? `https://www.youtube.com/watch?v=${videoId}` : null;
    }
  }
  return null;
}
```

### CORS について

Service Worker からの fetch は、`manifest.json` に `host_permissions` を追加することで CORS を回避できる。

```json
"host_permissions": ["https://www.youtube.com/*"]
```

---

## Manifest V3 の制約

- Service Worker は常駐しない（アラーム等のイベントで起動される）
- `chrome.alarms` で定期起動（最小間隔：1分）
- WebSocket の常時接続は維持できない → ポーリング方式が適切

---

## 将来的な拡張候補

- Twitch 対応（REST API ポーリング、App Access Token）
- ニコニコ生放送対応
