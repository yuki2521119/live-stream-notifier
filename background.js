import { isQuietHours, decodeXml, extractVideoDetailsBlocks, selectToOpen } from './utils.js';

// ─── 定数 ────────────────────────────────────────────────
const POLL_ALARM    = 'poll';
const LAUNCH_PREFIX = 'launch_';

const DEFAULT_SETTINGS = {
  intervalMinutes:     5,
  minutesBefore:       0,
  notificationEnabled: true,
  priorityEnabled:     false,
  quietHours: { enabled: false, start: '23:00', end: '07:00' },
};

// ─── ストレージ ───────────────────────────────────────────
async function getStorage() {
  const [sync, local] = await Promise.all([
    chrome.storage.sync.get(['channels', 'settings']),
    chrome.storage.local.get(['liveState', 'upcomingInfo']),
  ]);
  return {
    channels:     sync.channels  || [],
    settings:     { ...DEFAULT_SETTINGS, ...sync.settings },
    liveState:    local.liveState    || {},
    upcomingInfo: local.upcomingInfo || {},
  };
}

// ─── ライブ状態取得（/live ページスクレイピング）─────────
async function fetchLiveStatus(channelId) {
  try {
    const res = await fetch(`https://www.youtube.com/channel/${channelId}/live`);
    if (!res.ok) return offline();
    const html = await res.text();

    const blocks = extractVideoDetailsBlocks(html);
    if (!blocks.length) return offline();

    let upcomingCandidate = null;

    for (const section of blocks) {
      const ownerChannelId = section.match(/"channelId":"([^"]+)"/)?.[1];
      if (ownerChannelId !== channelId) continue;

      const videoId    = section.match(/"videoId":"([a-zA-Z0-9_-]{11})"/)?.[1] ?? null;
      const titleMatch = section.match(/"title":"((?:[^"\\]|\\.)*)"/);
      const title      = titleMatch ? decodeXml(titleMatch[1].replace(/\\"/g, '"')) : '';
      // scheduledStartTime は videoDetails 外に置かれることがあるためページ全体から検索
      const schMatch   = html.match(/"scheduledStartTime":"(\d+)"/);
      const scheduledAt = schMatch ? parseInt(schMatch[1], 10) * 1000 : null;

      if (section.includes('"isLive":true') && videoId) {
        return { status: 'active', videoId, title, scheduledAt: null };
      }
      if (section.includes('"isUpcoming":true') && videoId) {
        if (!upcomingCandidate ||
            (scheduledAt !== null &&
             (upcomingCandidate.scheduledAt === null || scheduledAt < upcomingCandidate.scheduledAt))) {
          upcomingCandidate = { videoId, title, scheduledAt };
        }
      }
    }

    if (upcomingCandidate) return { status: 'upcoming', ...upcomingCandidate };
    return offline();
  } catch (e) {
    console.error(`[fetchLiveStatus] ${channelId}:`, e);
    return offline();
  }
}

function offline() {
  return { status: 'offline', videoId: null, title: '', scheduledAt: null };
}

// ─── 通知・タブ ───────────────────────────────────────────
function sendNotification(channel, status) {
  const title = status === 'active'
    ? `🔴 ${channel.name} が配信を開始しました`
    : `📅 ${channel.name} の配信が予定されています`;
  chrome.notifications.create(`notif_${channel.id}`, {
    type: 'basic', iconUrl: 'icons/icon48.png',
    title, message: 'クリックして視聴する', priority: 2,
  });
}

function openTab(videoId) {
  chrome.tabs.create({ url: `https://www.youtube.com/watch?v=${videoId}` });
}

// ─── アラーム管理 ─────────────────────────────────────────
async function setupPollAlarm(intervalMinutes) {
  const minutes = Math.max(1, intervalMinutes);
  await chrome.alarms.clear(POLL_ALARM);
  chrome.alarms.create(POLL_ALARM, { periodInMinutes: minutes });
}

// ─── upcoming 処理 ────────────────────────────────────────
async function handleUpcoming(channel, videoId, title, scheduledAt, settings, upcomingInfo) {
  if (!upcomingInfo[channel.id]) {
    upcomingInfo[channel.id] = { videoId, title, scheduledAt, alarmSet: false, tabOpened: false };
  }

  const info = upcomingInfo[channel.id];
  if (channel.autoOpen && settings.minutesBefore > 0 && scheduledAt && !info.alarmSet) {
    const fireAt = scheduledAt - settings.minutesBefore * 60 * 1000;
    if (fireAt > Date.now()) {
      chrome.alarms.create(LAUNCH_PREFIX + channel.id, { when: fireAt });
    }
    upcomingInfo[channel.id].alarmSet = true;
  }
}

// ─── メインポーリング ─────────────────────────────────────
async function checkAllChannels() {
  const { channels, settings, liveState, upcomingInfo } = await getStorage();
  if (!channels.length) return;

  const results = await Promise.allSettled(channels.map(ch => fetchLiveStatus(ch.id)));

  const newLiveState    = { ...liveState };
  const newUpcomingInfo = { ...upcomingInfo };
  const newlyActive     = [];

  for (let i = 0; i < channels.length; i++) {
    const channel = channels[i];
    if (results[i].status !== 'fulfilled') continue;

    const { status, videoId, title, scheduledAt } = results[i].value;
    const prev = liveState[channel.id] || 'offline';

    if (prev === status) {
      if (status === 'upcoming') {
        const stored = newUpcomingInfo[channel.id];
        if (stored && videoId && stored.videoId !== videoId) {
          // 別の配信に切り替わった場合はリセット
          chrome.alarms.clear(LAUNCH_PREFIX + channel.id);
          newUpcomingInfo[channel.id] = { videoId, title, scheduledAt, alarmSet: false, tabOpened: false };
          await handleUpcoming(channel, videoId, title, scheduledAt, settings, newUpcomingInfo);
        } else if (stored) {
          // タイトル・時刻が変わっていれば更新
          const titleChanged     = title && title !== stored.title;
          const scheduleChanged  = scheduledAt && scheduledAt !== stored.scheduledAt;
          if (titleChanged || scheduleChanged) {
            newUpcomingInfo[channel.id] = {
              ...stored,
              ...(titleChanged    ? { title }       : {}),
              ...(scheduleChanged ? { scheduledAt, alarmSet: false } : {}),
            };
          }
          if (!newUpcomingInfo[channel.id].alarmSet) {
            await handleUpcoming(channel, stored.videoId, title || stored.title, scheduledAt || stored.scheduledAt, settings, newUpcomingInfo);
          }
        }
      }
      continue;
    }

    newLiveState[channel.id] = status;

    if (settings.notificationEnabled &&
        (status === 'active' || (status === 'upcoming' && prev === 'offline'))) {
      sendNotification(channel, status);
    }

    if (status === 'upcoming') {
      await handleUpcoming(channel, videoId, title, scheduledAt, settings, newUpcomingInfo);
    }

    if (status === 'active') {
      const info = newUpcomingInfo[channel.id];
      if (channel.autoOpen && !info?.tabOpened) newlyActive.push({ ...channel, videoId });
      chrome.alarms.clear(LAUNCH_PREFIX + channel.id);
      newUpcomingInfo[channel.id] = { videoId, title, scheduledAt: null, alarmSet: true, tabOpened: true };
    }

    if (status === 'offline' && newUpcomingInfo[channel.id]) {
      chrome.alarms.clear(LAUNCH_PREFIX + channel.id);
      delete newUpcomingInfo[channel.id];
    }
  }

  if (newlyActive.length && !isQuietHours(settings.quietHours)) {
    selectToOpen(newlyActive, channels, settings.priorityEnabled).forEach(ch => openTab(ch.videoId));
  }

  await chrome.storage.local.set({ liveState: newLiveState, upcomingInfo: newUpcomingInfo });
}

// ─── 予約アラーム発火 ─────────────────────────────────────
async function handleLaunchAlarm(channelId) {
  const { channels, settings, upcomingInfo } = await getStorage();
  const info = upcomingInfo[channelId];
  if (!info) return;

  const newUpcomingInfo = { ...upcomingInfo };
  if (!isQuietHours(settings.quietHours)) {
    const channel = channels.find(ch => ch.id === channelId);
    if (channel?.autoOpen) {
      openTab(info.videoId);
      newUpcomingInfo[channelId] = { ...info, tabOpened: true };
    }
  }
  await chrome.storage.local.set({ upcomingInfo: newUpcomingInfo });
}

// ─── 起動アラームのリセット（minutesBefore 変更時）────────
async function refreshLaunchAlarms() {
  const alarms = await chrome.alarms.getAll();
  await Promise.allSettled(
    alarms.filter(a => a.name.startsWith(LAUNCH_PREFIX)).map(a => chrome.alarms.clear(a.name))
  );
  const { upcomingInfo } = await getStorage();
  const reset = Object.fromEntries(
    Object.entries(upcomingInfo).map(([id, info]) => [id, { ...info, alarmSet: false, tabOpened: false }])
  );
  await chrome.storage.local.set({ upcomingInfo: reset });
  await checkAllChannels();
}

// ─── イベントリスナー ─────────────────────────────────────
chrome.runtime.onInstalled.addListener(async () => {
  const existing = await chrome.storage.sync.get(['channels', 'settings']);
  const settings = { ...DEFAULT_SETTINGS, ...existing.settings };
  await chrome.storage.sync.set({ channels: existing.channels || [], settings });
  await setupPollAlarm(settings.intervalMinutes);
  await checkAllChannels();
});

chrome.runtime.onStartup.addListener(async () => {
  const { settings } = await getStorage();
  await setupPollAlarm(settings.intervalMinutes);
  await checkAllChannels();
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === POLL_ALARM) {
    await checkAllChannels();
  } else if (alarm.name.startsWith(LAUNCH_PREFIX)) {
    await handleLaunchAlarm(alarm.name.slice(LAUNCH_PREFIX.length));
  }
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'RESET_ALARM') setupPollAlarm(msg.intervalMinutes);
  if (msg.type === 'CHECK_NOW') {
    checkAllChannels().finally(() => sendResponse({}));
    return true;
  }
  if (msg.type === 'REFRESH_LAUNCH_ALARMS') {
    refreshLaunchAlarms().finally(() => sendResponse({}));
    return true;
  }
});
