const DEFAULT_SETTINGS = {
  intervalMinutes: 5,
  minutesBefore: 0,
  notificationEnabled: true,
  priorityEnabled: false,
  quietHours: { enabled: false, start: '23:00', end: '07:00' },
};

// ─── 初期ロード ───────────────────────────────────────────
async function loadData() {
  const data = await chrome.storage.sync.get(['channels', 'settings']);
  return {
    channels: data.channels || [],
    settings: { ...DEFAULT_SETTINGS, ...data.settings },
  };
}

// ─── 優先順位リスト描画 ───────────────────────────────────
let channelOrder = []; // 並び替え後の順序を保持

function renderPriorityList(channels, enabled) {
  channelOrder = [...channels];
  const list = document.getElementById('priority-list');
  list.innerHTML = channelOrder.map((ch, i) => `
    <li draggable="${enabled}" data-index="${i}">
      <span class="drag-handle">${enabled ? '☰' : '─'}</span>
      <span>${ch.name}</span>
    </li>
  `).join('');
  if (enabled) setupDragAndDrop();
}

// ─── Drag & Drop ──────────────────────────────────────────
function setupDragAndDrop() {
  const list = document.getElementById('priority-list');
  let draggingEl = null;

  list.querySelectorAll('li').forEach(li => {
    li.addEventListener('dragstart', () => {
      draggingEl = li;
      setTimeout(() => li.classList.add('dragging'), 0);
    });
    li.addEventListener('dragend', () => {
      li.classList.remove('dragging');
      list.querySelectorAll('li').forEach(el => el.classList.remove('drag-over'));
      // DOM の順序から channelOrder を再構築
      channelOrder = [...list.querySelectorAll('li')].map(el => channelOrder[Number(el.dataset.index)]);
      // data-index を振り直す
      list.querySelectorAll('li').forEach((el, i) => el.setAttribute('data-index', i));
    });
    li.addEventListener('dragover', (e) => {
      e.preventDefault();
      list.querySelectorAll('li').forEach(el => el.classList.remove('drag-over'));
      if (li !== draggingEl) li.classList.add('drag-over');
    });
    li.addEventListener('drop', (e) => {
      e.preventDefault();
      if (draggingEl && draggingEl !== li) list.insertBefore(draggingEl, li);
    });
  });
}

// ─── 初期化 ───────────────────────────────────────────────
async function init() {
  const { channels, settings } = await loadData();

  // フォームへ反映
  document.getElementById('interval').value       = settings.intervalMinutes;
  document.getElementById('minutes-before').value  = settings.minutesBefore;
  document.getElementById('notification').checked  = settings.notificationEnabled;
  document.getElementById('priority-enabled').checked = settings.priorityEnabled;

  const quietEnabled = document.getElementById('quiet-enabled');
  const quietRange   = document.getElementById('quiet-range');
  quietEnabled.checked = settings.quietHours.enabled;
  quietRange.hidden    = !settings.quietHours.enabled;
  document.getElementById('quiet-start').value = settings.quietHours.start;
  document.getElementById('quiet-end').value   = settings.quietHours.end;

  renderPriorityList(channels, settings.priorityEnabled);

  // おやすみ時間トグル
  quietEnabled.addEventListener('change', () => {
    quietRange.hidden = !quietEnabled.checked;
  });

  // 優先順位モードトグル → リスト再描画
  document.getElementById('priority-enabled').addEventListener('change', (e) => {
    renderPriorityList(channelOrder, e.target.checked);
  });

  // 保存
  document.getElementById('save-btn').addEventListener('click', async () => {
    const intervalMinutes = Math.max(1, Number(document.getElementById('interval').value));
    const newSettings = {
      intervalMinutes,
      minutesBefore:       Math.max(0, Number(document.getElementById('minutes-before').value)),
      notificationEnabled: document.getElementById('notification').checked,
      priorityEnabled:     document.getElementById('priority-enabled').checked,
      quietHours: {
        enabled: quietEnabled.checked,
        start:   document.getElementById('quiet-start').value,
        end:     document.getElementById('quiet-end').value,
      },
    };

    await chrome.storage.sync.set({ settings: newSettings, channels: channelOrder });

    // ポーリング間隔が変わった場合、background に通知
    if (intervalMinutes !== settings.intervalMinutes) {
      chrome.runtime.sendMessage({ type: 'RESET_ALARM', intervalMinutes });
    }

    // minutesBefore が変わった場合は既存アラームをリセット、そうでなければ即時チェック
    if (newSettings.minutesBefore !== settings.minutesBefore) {
      chrome.runtime.sendMessage({ type: 'REFRESH_LAUNCH_ALARMS' });
    } else {
      chrome.runtime.sendMessage({ type: 'CHECK_NOW' });
    }

    const msg = document.getElementById('save-msg');
    msg.textContent = '保存しました';
    setTimeout(() => { msg.textContent = ''; }, 2000);
  });
}

init();
