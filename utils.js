// ─── おやすみ時間判定 ─────────────────────────────────────
export function isQuietHours({ enabled, start, end }) {
  if (!enabled) return false;
  const now = new Date();
  const cur = now.getHours() * 60 + now.getMinutes();
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  const s = sh * 60 + sm;
  const e = eh * 60 + em;
  return s > e ? (cur >= s || cur < e) : (cur >= s && cur < e);
}

// ─── XML エンティティデコード ──────────────────────────────
export function decodeXml(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

// ─── videoDetails ブロック抽出 ────────────────────────────
// 文字列内の {} を正しくスキップしてカウントし、全ブロックを返す
export function extractVideoDetailsBlocks(html) {
  const blocks = [];
  let pos = 0;
  while (pos < html.length) {
    const start = html.indexOf('"videoDetails":{', pos);
    if (start === -1) break;
    let depth = 0, inStr = false, esc = false;
    let end = start + '"videoDetails":'.length;
    for (let i = end; i < html.length; i++) {
      const c = html[i];
      if (esc)               { esc = false; continue; }
      if (c === '\\' && inStr) { esc = true;  continue; }
      if (c === '"')         { inStr = !inStr; continue; }
      if (inStr)             continue;
      if (c === '{')         depth++;
      else if (c === '}')    { depth--; if (depth === 0) { end = i + 1; break; } }
    }
    blocks.push(html.slice(start, end));
    pos = end;
  }
  return blocks;
}

// ─── 優先チャンネル選択 ───────────────────────────────────
export function selectToOpen(candidates, channels, priorityEnabled) {
  if (!priorityEnabled) return candidates;
  const top = channels.find(ch => candidates.some(c => c.id === ch.id));
  return top ? [candidates.find(c => c.id === top.id)] : [];
}

// ─── 配信時刻フォーマット ─────────────────────────────────
export function formatScheduledAt(ms) {
  if (!ms) return '時刻不明';
  const d        = new Date(ms);
  const now      = new Date();
  const time     = d.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (d.toDateString() === now.toDateString())      return `今日 ${time}`;
  if (d.toDateString() === tomorrow.toDateString()) return `明日 ${time}`;
  return `${d.getMonth() + 1}/${d.getDate()} ${time}`;
}

// ─── チャンネル入力解決 ───────────────────────────────────
export async function resolveChannelInput(input) {
  const s = input.trim();

  if (/^UC[\w-]{22}$/.test(s)) return { id: s, name: null };

  const idFromUrl = s.match(/youtube\.com\/channel\/(UC[\w-]{22})/);
  if (idFromUrl) return { id: idFromUrl[1], name: null };

  let handle = null;
  const handleFromUrl = s.match(/youtube\.com\/@([\w.-]+)/);
  if (handleFromUrl)      handle = handleFromUrl[1];
  else if (s.startsWith('@')) handle = s.slice(1);
  if (!handle) return null;

  const res = await fetch(`https://www.youtube.com/@${handle}`);
  if (!res.ok) return null;
  const html = await res.text();

  const idMatch = html.match(/"externalId":"(UC[\w-]{22})"/);
  if (!idMatch) return null;

  const nameMeta = html.match(/<meta[^>]*property="og:title"[^>]*content="([^"]+)"/);
  return { id: idMatch[1], name: nameMeta ? nameMeta[1] : handle };
}
