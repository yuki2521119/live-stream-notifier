// ─── 定数 ────────────────────────────────────────────────
const POLL_ALARM = 'poll';
const LAUNCH_PREFIX = 'launch_';

const DEFAULT_SETTINGS = {
  intervalMinutes: 5,
  minutesBefore: 0,
  notificationEnabled: true,
  priorityEnabled: false,
  quietHours: { enabled: false, start: '23:00', end: '07:00' },
};

// ─── ストレージ ───────────────────────────────────────────
async function getStorage() {
  const [sync, local] = await Promise.all([
    chrome.storage.sync.get(['channels', 'settings']),
    chrome.storage.local.get(['liveState', 'upcomingInfo']),
  ]);
  return {
    channels: sync.channels || [],
    settings: { ...DEFAULT_SETTINGS, ...sync.settings },
    liveState: local.liveState || {},
    upcomingInfo: local.upcomingInfo || {},
  };
}

// ─── おやすみ時間判定 ─────────────────────────────────────
function isQuietHours({ enabled, start, end }) {
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
function decodeXml(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

// ─── ライブ状態取得（/live ページ）───────────────────────
// RSS には liveBroadcastStatus が含まれないため、
// youtube.com/channel/CHANNEL_ID/live を取得して判定する
async function fetchLiveStatus(channelId) {
  try {
    const res = await fetch(`https://www.youtube.com/channel/${channelId}/live`);
    if (!res.ok) return { status: 'offline', videoId: null, title: '', scheduledAt: null };
    const html = await res.text();

    const detailsMatch = html.match(/"videoId":"([a-zA-Z0-9_-]{11})","title":"((?:[^"\\]|\\.)*)"/);
    const videoId = detailsMatch?.[1] ?? (html.match(/"videoId":"([a-zA-Z0-9_-]{11})"/) || [])[1] ?? null;
    const title   = detailsMatch ? decodeXml(detailsMatch[2].replace(/\\"/g, '"')) : '';

    const scheduledMatch = html.match(/"scheduledStartTime":"(\d+)"/);
    if (html.includes('"isUpcoming":true') && videoId) {
      return { status: 'upcoming', videoId, title, scheduledAt: scheduledMatch ? parseInt(scheduledMatch[1], 10) * 1000 : null };
    }

    if (html.includes('"isLive":true') && videoId) {
      return { status: 'active', videoId, title, scheduledAt: null };
    }

    return { status: 'offline', videoId: null, title: '', scheduledAt: null };
  } catch (e) {
    console.error(`[fetchLiveStatus] ${channelId}:`, e);
    return { status: 'offline', videoId: null, title: '', scheduledAt: null };
  }
}

// ─── 通知・タブ ───────────────────────────────────────────
function sendNotification(channel, status) {
  const title = status === 'active'
    ? `🔴 ${channel.name} が配信を開始しました`
    : `📅 ${channel.name} の配信が予定されています`;
  chrome.notifications.create(`notif_${channel.id}`, {
    type: 'basic',
    iconUrl: 'icons/icon48.png',
    title,
    message: 'クリックして視聴する',
    priority: 2,
  });
}

function openTab(videoId) {
  chrome.tabs.create({ url: `https://www.youtube.com/watch?v=${videoId}` });
}

function selectToOpen(candidates, channels, priorityEnabled) {
  if (!priorityEnabled) return candidates;
  const top = channels.find(ch => candidates.some(c => c.id === ch.id));
  return top ? [candidates.find(c => c.id === top.id)] : [];
}

// ─── アラーム管理 ─────────────────────────────────────────
async function setupPollAlarm(intervalMinutes) {
  const minutes = Math.max(1, intervalMinutes);
  await chrome.alarms.clear(POLL_ALARM);
  chrome.alarms.create(POLL_ALARM, { periodInMinutes: minutes });
}

// ─── upcoming 処理 ────────────────────────────────────────
async function handleUpcoming(channel, videoId, title, scheduledAt, settings, upcomingInfo) {
  if (upcomingInfo[channel.id]) return; // 重複スキップ

  upcomingInfo[channel.id] = { videoId, title, scheduledAt, alarmSet: false };

  if (channel.autoOpen && settings.minutesBefore > 0 && scheduledAt) {
    const fireAt = scheduledAt - settings.minutesBefore * 60 * 1000;
    if (fireAt > Date.now()) {
      chrome.alarms.create(LAUNCH_PREFIX + channel.id, { when: fireAt });
      upcomingInfo[channel.id].alarmSet = true;
    }
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
      // タイトルが未取得のまま upcoming が継続している場合は更新する
      if (status === 'upcoming' && title && newUpcomingInfo[channel.id] && !newUpcomingInfo[channel.id].title) {
        newUpcomingInfo[channel.id] = { ...newUpcomingInfo[channel.id], title };
      }
      continue;
    }

    newLiveState[channel.id] = status;

    if (settings.notificationEnabled) {
      if (status === 'active' || (status === 'upcoming' && prev === 'offline')) {
        sendNotification(channel, status);
      }
    }

    if (status === 'upcoming') {
      await handleUpcoming(channel, videoId, title, scheduledAt, settings, newUpcomingInfo);
    }

    if (status === 'active') {
      const info = newUpcomingInfo[channel.id];
      if (channel.autoOpen) {
        if (settings.minutesBefore === 0 || (info && info.scheduledAt === null)) {
          newlyActive.push({ ...channel, videoId });
        }
      }
      if (info) {
        chrome.alarms.clear(LAUNCH_PREFIX + channel.id);
        delete newUpcomingInfo[channel.id];
      }
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

  if (!isQuietHours(settings.quietHours)) {
    const channel = channels.find(ch => ch.id === channelId);
    if (channel?.autoOpen) openTab(info.videoId);
  }

  const newUpcomingInfo = { ...upcomingInfo };
  delete newUpcomingInfo[channelId];
  await chrome.storage.local.set({ upcomingInfo: newUpcomingInfo });
}

// ─── イベントリスナー ─────────────────────────────────────
chrome.runtime.onInstalled.addListener(async () => {
  const existing = await chrome.storage.sync.get(['channels', 'settings']);
  const settings = { ...DEFAULT_SETTINGS, ...existing.settings };
  await chrome.storage.sync.set({
    channels: existing.channels || [],
    settings,
  });
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
});
