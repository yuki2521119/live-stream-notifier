import { formatScheduledAt, resolveChannelInput } from './utils.js';

const STATUS_LABEL = { active: 'LIVE', upcoming: '配信予定', offline: 'オフライン' };

async function loadData() {
  const [sync, local] = await Promise.all([
    chrome.storage.sync.get('channels'),
    chrome.storage.local.get(['liveState', 'upcomingInfo']),
  ]);
  return {
    channels:     sync.channels || [],
    liveState:    local.liveState || {},
    upcomingInfo: local.upcomingInfo || {},
  };
}

async function saveChannels(channels) {
  await chrome.storage.sync.set({ channels });
}

function renderList(channels, liveState, upcomingInfo) {
  const list = document.getElementById('channel-list');
  if (!channels.length) {
    list.innerHTML = '<div class="empty">チャンネルが登録されていません</div>';
    return;
  }
  list.innerHTML = channels.map((ch, i) => {
    const st   = liveState[ch.id] || 'offline';
    const info = upcomingInfo[ch.id];
    // upcoming は時刻を status-label の位置に表示、時刻不明なら「配信予定」
    const statusText = (st === 'upcoming' && info?.scheduledAt)
      ? formatScheduledAt(info.scheduledAt)
      : STATUS_LABEL[st] || '';
    const sub  = ((st === 'upcoming' || st === 'active') && info && info.title)
      ? `<div class="stream-info">
           <span class="stream-title" data-video-id="${info.videoId}" title="クリックで配信を開く">${info.title}</span>
         </div>`
      : '';
    return `
      <div class="channel-item" data-index="${i}" data-status="${st}">
        <div class="channel-main">
          <div class="status-dot"></div>
          <div class="channel-body">
            <span class="channel-name" title="${ch.name}">${ch.name}</span>
            <span class="status-label">${statusText}</span>
          </div>
          <label class="toggle" title="自動起動">
            <input type="checkbox" class="auto-open" data-index="${i}" ${ch.autoOpen ? 'checked' : ''}>
            <span class="slider"></span>
          </label>
          <button class="del-btn" data-index="${i}" title="削除">✕</button>
        </div>
        ${sub}
      </div>`;
  }).join('');
}

async function init() {
  let { channels, liveState, upcomingInfo } = await loadData();
  renderList(channels, liveState, upcomingInfo);

  // liveState / upcomingInfo が更新されたら自動再描画
  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area !== 'local') return;
    if (changes.liveState || changes.upcomingInfo) {
      ({ channels, liveState, upcomingInfo } = await loadData());
      renderList(channels, liveState, upcomingInfo);
    }
  });

  // 今すぐ確認ボタン
  const refreshBtn = document.getElementById('refresh-btn');
  refreshBtn.addEventListener('click', () => {
    refreshBtn.classList.add('spinning');
    chrome.runtime.sendMessage({ type: 'CHECK_NOW' });
    setTimeout(() => refreshBtn.classList.remove('spinning'), 2000);
  });

  // 設定ページ
  document.getElementById('opts-btn').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  // チャンネル追加フォームの表示切替
  const addToggle = document.getElementById('add-toggle');
  const addForm   = document.getElementById('add-form');
  const cancelBtn = document.getElementById('cancel-btn');

  const submitBtn = document.getElementById('submit-btn');
  const errorEl   = document.getElementById('add-error');

  function setFormError(msg) {
    errorEl.textContent = msg;
    errorEl.hidden = !msg;
  }

  addToggle.addEventListener('click', () => {
    addForm.hidden = false;
    addToggle.hidden = true;
    document.getElementById('input-query').focus();
  });
  cancelBtn.addEventListener('click', () => {
    addForm.hidden = true;
    addToggle.hidden = false;
    addForm.reset();
    setFormError('');
  });

  // チャンネル追加
  addForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const query = document.getElementById('input-query').value.trim();
    if (!query) return;

    setFormError('');
    submitBtn.disabled = true;
    submitBtn.textContent = '解決中…';

    let resolved;
    try {
      resolved = await resolveChannelInput(query);
    } catch {
      resolved = null;
    }

    submitBtn.disabled = false;
    submitBtn.textContent = '追加';

    if (!resolved) {
      setFormError('チャンネルが見つかりませんでした。入力を確認してください。');
      return;
    }

    // 重複チェック
    if (channels.some(ch => ch.id === resolved.id)) {
      setFormError('このチャンネルはすでに登録されています。');
      return;
    }

    const nameInput = document.getElementById('input-name').value.trim();
    const name = nameInput || resolved.name || resolved.id;

    channels = [...channels, { id: resolved.id, name, autoOpen: false }];
    await saveChannels(channels);
    renderList(channels, liveState, upcomingInfo);
    addForm.reset();
    addForm.hidden = true;
    addToggle.hidden = false;
    chrome.runtime.sendMessage({ type: 'CHECK_NOW' });
  });

  // 配信タイトルクリック → 別タブで開く
  document.getElementById('channel-list').addEventListener('click', (e) => {
    const title = e.target.closest('.stream-title');
    if (!title?.dataset.videoId) return;
    chrome.tabs.create({ url: `https://www.youtube.com/watch?v=${title.dataset.videoId}` });
  });

  // イベント委任：トグル・削除
  document.getElementById('channel-list').addEventListener('change', async (e) => {
    if (!e.target.classList.contains('auto-open')) return;
    const i = Number(e.target.dataset.index);
    channels[i] = { ...channels[i], autoOpen: e.target.checked };
    await saveChannels(channels);
    // トグル変更を即座にバックグラウンドへ反映
    chrome.runtime.sendMessage({ type: 'CHECK_NOW' });
  });

  document.getElementById('channel-list').addEventListener('click', async (e) => {
    const btn = e.target.closest('.del-btn');
    if (!btn) return;
    const i = Number(btn.dataset.index);
    const deletedId = channels[i].id;
    channels = channels.filter((_, idx) => idx !== i);
    await saveChannels(channels);

    const local = await chrome.storage.local.get(['liveState', 'upcomingInfo']);
    const newLiveState    = { ...local.liveState };
    const newUpcomingInfo = { ...local.upcomingInfo };
    delete newLiveState[deletedId];
    delete newUpcomingInfo[deletedId];
    await chrome.storage.local.set({ liveState: newLiveState, upcomingInfo: newUpcomingInfo });

    renderList(channels, liveState, upcomingInfo);
  });
}

init();
