const CHANGE_EVENTS_KEY = 'visualMonitorChangeEvents';
const READ_EVENTS_KEY = 'visualMonitorReadEventIds';

let currentPayload = { items: [] };
let currentReadIds = [];
let previousUnreadCount = null;

function getItemKey(item) {
  return String(item?.eventId || item?.id || item?.itemUrl || item?.url || item?.changedAt || '');
}

function playNotificationSound() {
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;

    const context = new AudioContextClass();
    const oscillator = context.createOscillator();
    const gain = context.createGain();

    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(880, context.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(1320, context.currentTime + 0.08);
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.08, context.currentTime + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.22);

    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.24);
    setTimeout(() => context.close(), 320);
  } catch (_) {
    // Chrome may block sound until popup interaction.
  }
}

function getUnreadItems(payload, readIds) {
  const items = Array.isArray(payload?.items) ? payload.items : [];
  const readSet = new Set(Array.isArray(readIds) ? readIds : []);
  return items.filter((item) => {
    const key = getItemKey(item);
    return key && !readSet.has(key);
  });
}

function saveReadIds(readIds, callback) {
  const unique = Array.from(new Set(readIds.filter(Boolean)));
  chrome.storage.local.set({ [READ_EVENTS_KEY]: unique }, () => {
    currentReadIds = unique;
    if (callback) callback();
    render(currentPayload, currentReadIds);
  });
}

function markItemRead(item, callback) {
  const key = getItemKey(item);
  if (!key) {
    if (callback) callback();
    return;
  }
  saveReadIds([...currentReadIds, key], callback);
}

function markAllRead() {
  const allKeys = (Array.isArray(currentPayload?.items) ? currentPayload.items : []).map(getItemKey).filter(Boolean);
  saveReadIds([...currentReadIds, ...allKeys]);
}

function formatDate(value) {
  if (!value) return '-';
  try {
    return new Intl.DateTimeFormat('az-AZ', {
      timeZone: 'Asia/Baku',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(value));
  } catch (_) {
    return value;
  }
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function getInitial(item) {
  const value = String(item?.name || item?.domain || item?.url || 'VM').trim();
  return (value[0] || 'V').toUpperCase();
}

function render(payload, readIds = []) {
  currentPayload = payload || { items: [] };
  currentReadIds = Array.isArray(readIds) ? readIds : [];

  const unreadItems = getUnreadItems(currentPayload, currentReadIds);
  const previous = previousUnreadCount;
  previousUnreadCount = unreadItems.length;
  if (previous !== null && unreadItems.length > previous) playNotificationSound();
  document.getElementById('count').textContent = String(unreadItems.length);
  document.getElementById('markAllRead').disabled = unreadItems.length === 0;
  const list = document.getElementById('list');

  if (!unreadItems.length) {
    list.innerHTML = '<div class="empty">Yeni oxunmamış dəyişiklik yoxdur.</div>';
    return;
  }

  list.innerHTML = unreadItems.map((item, index) => {
    const link = item.itemUrl || item.url || '';
    return `
      <div class="item unread">
        <div class="icon">${escapeHtml(getInitial(item))}</div>
        <div class="content">
          <div class="name-row">
            <div class="name">${escapeHtml(item.name || item.domain || 'İzləmə')}</div>
            <span class="pill">Yeni</span>
          </div>
          <div class="summary">${escapeHtml(item.title || item.summary || 'Dəyişiklik tapılıb.')}</div>
          <div class="meta">Mənbə: ${escapeHtml(item.domain || item.url || '-')}</div>
          <div class="meta">Saytda yayımlandığı tarix: ${escapeHtml(item.published || '-')}</div>
          <div class="meta">Aşkarlanma vaxtı: ${escapeHtml(formatDate(item.changedAt))}</div>
          <div class="meta link">${escapeHtml(link)}</div>
          <div class="actions">
            <button class="link-button" data-open="${index}" type="button">Aç</button>
            <button class="read-button" data-read="${index}" type="button">Oxundu</button>
          </div>
        </div>
      </div>
    `;
  }).join('');

  list.querySelectorAll('[data-open]').forEach((button) => {
    button.addEventListener('click', () => {
      const item = unreadItems[Number(button.dataset.open)];
      const link = item?.itemUrl || item?.url;
      markItemRead(item, () => {
        if (link) chrome.tabs.create({ url: link });
      });
    });
  });

  list.querySelectorAll('[data-read]').forEach((button) => {
    button.addEventListener('click', () => {
      const item = unreadItems[Number(button.dataset.read)];
      markItemRead(item);
    });
  });
}

async function startSelector() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !/^https?:\/\//i.test(tab.url || '')) return;
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content-script.js'] });
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => window.dispatchEvent(new CustomEvent('visual-monitor-selector-show-panel')),
  });
  window.close();
}

document.getElementById('startSelector').addEventListener('click', startSelector);
document.getElementById('markAllRead').addEventListener('click', markAllRead);
chrome.storage.local.get([CHANGE_EVENTS_KEY, READ_EVENTS_KEY], (result) => {
  render(result[CHANGE_EVENTS_KEY], result[READ_EVENTS_KEY]);
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes[CHANGE_EVENTS_KEY]) currentPayload = changes[CHANGE_EVENTS_KEY].newValue || { items: [] };
  if (changes[READ_EVENTS_KEY]) currentReadIds = changes[READ_EVENTS_KEY].newValue || [];
  if (changes[CHANGE_EVENTS_KEY] || changes[READ_EVENTS_KEY]) render(currentPayload, currentReadIds);
});

