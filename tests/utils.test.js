import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  isQuietHours,
  decodeXml,
  extractVideoDetailsBlocks,
  selectToOpen,
  formatScheduledAt,
  resolveChannelInput,
} from '../utils.js';

// ─── isQuietHours ─────────────────────────────────────────
describe('isQuietHours', () => {
  const fake = (h, m) => vi.setSystemTime(new Date(2024, 0, 1, h, m));

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('disabled の場合は常に false', () => {
    fake(2, 0);
    expect(isQuietHours({ enabled: false, start: '00:00', end: '08:00' })).toBe(false);
  });

  it('範囲内（23:00〜07:00 の 02:00）→ true', () => {
    fake(2, 0);
    expect(isQuietHours({ enabled: true, start: '23:00', end: '07:00' })).toBe(true);
  });

  it('範囲内（23:00〜07:00 の 23:30）→ true', () => {
    fake(23, 30);
    expect(isQuietHours({ enabled: true, start: '23:00', end: '07:00' })).toBe(true);
  });

  it('範囲外（23:00〜07:00 の 12:00）→ false', () => {
    fake(12, 0);
    expect(isQuietHours({ enabled: true, start: '23:00', end: '07:00' })).toBe(false);
  });

  it('境界（終了時刻ちょうど 07:00）→ false（終了は含まない）', () => {
    fake(7, 0);
    expect(isQuietHours({ enabled: true, start: '23:00', end: '07:00' })).toBe(false);
  });

  it('日をまたがない範囲（10:00〜18:00 の 14:00）→ true', () => {
    fake(14, 0);
    expect(isQuietHours({ enabled: true, start: '10:00', end: '18:00' })).toBe(true);
  });

  it('日をまたがない範囲（10:00〜18:00 の 09:00）→ false', () => {
    fake(9, 0);
    expect(isQuietHours({ enabled: true, start: '10:00', end: '18:00' })).toBe(false);
  });
});

// ─── decodeXml ────────────────────────────────────────────
describe('decodeXml', () => {
  it('&amp; を & にデコード', () => {
    expect(decodeXml('A&amp;B')).toBe('A&B');
  });

  it('&lt; &gt; をデコード', () => {
    expect(decodeXml('&lt;div&gt;')).toBe('<div>');
  });

  it('&quot; をデコード', () => {
    expect(decodeXml('say &quot;hello&quot;')).toBe('say "hello"');
  });

  it("&#39; をデコード", () => {
    expect(decodeXml("it&#39;s")).toBe("it's");
  });

  it('エンティティなしはそのまま', () => {
    expect(decodeXml('hello world')).toBe('hello world');
  });

  it('複数エンティティを同時にデコード', () => {
    expect(decodeXml('&lt;p&gt;A&amp;B&lt;/p&gt;')).toBe('<p>A&B</p>');
  });
});

// ─── extractVideoDetailsBlocks ────────────────────────────
describe('extractVideoDetailsBlocks', () => {
  it('ブロックなし → 空配列', () => {
    expect(extractVideoDetailsBlocks('<html></html>')).toEqual([]);
  });

  it('ブロック1つを正しく抽出', () => {
    const html = '"videoDetails":{"videoId":"abc","isLive":false}';
    const blocks = extractVideoDetailsBlocks(html);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toContain('"videoId":"abc"');
  });

  it('ブロック2つを両方抽出', () => {
    const html = '"videoDetails":{"videoId":"aaa"}"videoDetails":{"videoId":"bbb"}';
    const blocks = extractVideoDetailsBlocks(html);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toContain('"videoId":"aaa"');
    expect(blocks[1]).toContain('"videoId":"bbb"');
  });

  it('文字列内の {} をスキップして正しく抽出', () => {
    const html = '"videoDetails":{"keywords":["tag{1}","tag}2"],"videoId":"xyz"}';
    const blocks = extractVideoDetailsBlocks(html);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toContain('"videoId":"xyz"');
  });

  it('エスケープされたクォートをスキップ', () => {
    const html = '"videoDetails":{"title":"say \\"hello\\"","videoId":"esc"}';
    const blocks = extractVideoDetailsBlocks(html);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toContain('"videoId":"esc"');
  });

  it('ネストしたオブジェクトを正しくカウント', () => {
    const html = '"videoDetails":{"thumbnail":{"url":"http://example.com"},"videoId":"nested"}';
    const blocks = extractVideoDetailsBlocks(html);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toContain('"videoId":"nested"');
  });
});

// ─── selectToOpen ─────────────────────────────────────────
describe('selectToOpen', () => {
  const channels = [
    { id: 'ch1', name: 'A' },
    { id: 'ch2', name: 'B' },
  ];
  const candidates = [
    { id: 'ch1', videoId: 'v1' },
    { id: 'ch2', videoId: 'v2' },
  ];

  it('priorityEnabled=false → 全候補を返す', () => {
    expect(selectToOpen(candidates, channels, false)).toEqual(candidates);
  });

  it('priorityEnabled=true → channels 順位が上の 1 件のみ', () => {
    const result = selectToOpen(candidates, channels, true);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('ch1');
  });

  it('候補が 1 件なら priority 関係なく 1 件', () => {
    const single = [{ id: 'ch2', videoId: 'v2' }];
    expect(selectToOpen(single, channels, true)).toHaveLength(1);
    expect(selectToOpen(single, channels, false)).toHaveLength(1);
  });

  it('候補が空 → 空配列', () => {
    expect(selectToOpen([], channels, true)).toEqual([]);
    expect(selectToOpen([], channels, false)).toEqual([]);
  });
});

// ─── formatScheduledAt ────────────────────────────────────
describe('formatScheduledAt', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('null/0 → 時刻不明', () => {
    expect(formatScheduledAt(null)).toBe('時刻不明');
    expect(formatScheduledAt(0)).toBe('時刻不明');
  });

  it('今日の時刻 → 今日 HH:MM', () => {
    vi.setSystemTime(new Date('2024-05-01T10:00:00'));
    const ms = new Date('2024-05-01T21:00:00').getTime();
    expect(formatScheduledAt(ms)).toMatch(/^今日 /);
  });

  it('明日の時刻 → 明日 HH:MM', () => {
    vi.setSystemTime(new Date('2024-05-01T10:00:00'));
    const ms = new Date('2024-05-02T21:00:00').getTime();
    expect(formatScheduledAt(ms)).toMatch(/^明日 /);
  });

  it('それ以外 → M/D HH:MM', () => {
    vi.setSystemTime(new Date('2024-05-01T10:00:00'));
    const ms = new Date('2024-05-10T21:00:00').getTime();
    expect(formatScheduledAt(ms)).toMatch(/^5\/10 /);
  });
});

// ─── resolveChannelInput ──────────────────────────────────
describe('resolveChannelInput', () => {
  afterEach(() => vi.restoreAllMocks());

  it('チャンネルID を直接渡す → そのまま返す', async () => {
    const id = 'UCBevglqnSLfJ_G_xC8Mw2Mw';
    const result = await resolveChannelInput(id);
    expect(result).toEqual({ id, name: null });
  });

  it('チャンネルIDを含むURL → ID を抽出', async () => {
    const url = 'https://www.youtube.com/channel/UCBevglqnSLfJ_G_xC8Mw2Mw';
    const result = await resolveChannelInput(url);
    expect(result).toEqual({ id: 'UCBevglqnSLfJ_G_xC8Mw2Mw', name: null });
  });

  it('@ハンドル → フェッチしてIDと名前を返す', async () => {
    const html = `"externalId":"UCtest1234567890123456ab"<meta property="og:title" content="Test Channel">`;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve(html) }));
    const result = await resolveChannelInput('@testchannel');
    expect(result).toEqual({ id: 'UCtest1234567890123456ab', name: 'Test Channel' });
  });

  it('不正な入力 → null', async () => {
    expect(await resolveChannelInput('not-a-channel')).toBeNull();
  });

  it('フェッチ失敗 → null', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    expect(await resolveChannelInput('@failchannel')).toBeNull();
  });

  it('IDが見つからないHTML → null', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve('<html>no id here</html>') }));
    expect(await resolveChannelInput('@nochannel')).toBeNull();
  });
});
