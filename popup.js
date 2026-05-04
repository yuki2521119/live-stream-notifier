const STATUS_ICON  = { active: '🔴', upcoming: '📅', offline: '⚫' };
const STATUS_LABEL = { active: '配信中', upcoming: '配信予定', offline: 'オフライン' };

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

// ─── チャンネル入力の解決 ─────────────────────────────────
// @ハンドル・URL・チャンネルID を受け取り { id, name } を返す
async function resolveChannelInput(input) {
  const s = input.trim();

  // チャンネルID（UCから始まる24文字）
  if (/^UC[\w-]{22}$/.test(s)) return { id: s, name: null };

  // URL中にチャンネルIDが含まれる場合
  const idFromUrl = s.match(/youtube\.com\/channel\/(UC[\w-]{22})/);
  if (idFromUrl) return { id: idFromUrl[1], name: null };

  // @ハンドルを特定（URL形式またはそのまま）
  let handle = null;
  const handleFromUrl = s.match(/youtube\.com\/@([\w.-]+)/);
  if (handleFromUrl)    handle = handleFromUrl[1];
  else if (s.startsWith('@')) handle = s.slice(1);
  if (!handle) return null;

  // チャンネルページをフェッチしてIDと名前を取得
  const res = await fetch(`https://www.youtube.com/@${handle}`);
  if (!res.ok) return null;
  const html = await res.text();

  const idMatch = html.match(/"externalId":"(UC[\w-]{22})"/);
  if (!idMatch) return null;

  const nameTitleTag = html.match(/<meta[^>]*property="og:title"[^>]*>/);
  const nameMatch    = nameTitleTag ? nameTitleTag[0].match(/content="([^"]+)"/) : null;
  return { id: idMatch[1], name: nameMatch ? nameMatch[1] : handle };
}

function formatScheduledAt(ms) {
  if (!ms) return '時刻不明';
  const d   = new Date(ms);
  const now = new Date();
  const time = d.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (d.toDateString() === now.toDateString())      return `今日 ${time}`;
  if (d.toDateString() === tomorrow.toDateString()) return `明日 ${time}`;
  return `${d.getMonth() + 1}/${d.getDate()} ${time}`;
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
    const sub  = (st === 'upcoming' && info)
      ? `<div class="stream-info">
           <span class="stream-title">${info.title || '（タイトル不明）'}</span>
           <span class="stream-time">${formatScheduledAt(info.scheduledAt)}</span>
         </div>`
      : '';
    return `
      <div class="channel-item" data-index="${i}">
        <div class="channel-main">
          <span class="status-icon">${STATUS_ICON[st] || '⚫'}</span>
          <div class="channel-body">
            <span class="channel-name" title="${ch.name}">${ch.name}</span>
            <span class="status-label">${STATUS_LABEL[st] || ''}</span>
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

  // イベント委任：トグル・削除
  document.getElementById('channel-list').addEventListener('change', async (e) => {
    if (!e.target.classList.contains('auto-open')) return;
    const i = Number(e.target.dataset.index);
    channels[i] = { ...channels[i], autoOpen: e.target.checked };
    await saveChannels(channels);
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
