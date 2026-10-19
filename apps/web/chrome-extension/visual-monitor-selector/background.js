const CHANGE_EVENTS_KEY = 'visualMonitorChangeEvents';
const READ_EVENTS_KEY = 'visualMonitorReadEventIds';

let previousUnreadCount = null;
const NOTIFICATION_ICON = 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22128%22 height=%22128%22 viewBox=%220 0 128 128%22%3E%3Crect width=%22128%22 height=%22128%22 rx=%2228%22 fill=%22%230f172a%22/%3E%3Cpath d=%22M34 73h60l-9-13V46c0-12-9-22-21-22S43 34 43 46v14L34 73z%22 fill=%22%23facc15%22/%3E%3Cpath d=%22M55 82c2 6 6 9 9 9s8-3 9-9H55z%22 fill=%22%23fde68a%22/%3E%3C/svg%3E';

function getItemKey(item) {
  return String(item?.eventId || item?.id || item?.itemUrl || item?.url || item?.changedAt || '');
}

function getUnreadItems(payload, readIds) {
  const items = Array.isArray(payload?.items) ? payload.items : [];
  const readSet = new Set(Array.isArray(readIds) ? readIds : []);
  return items.filter((item) => {
    const key = getItemKey(item);
    return key && !readSet.has(key);
  });
}

function notifyNewChanges(unreadItems, previousCount) {
  if (!chrome.notifications || previousCount === null || unreadItems.length <= previousCount) return;

  const newest = unreadItems[0] || {};
  const extra = unreadItems.length - 1;
  const message = (newest.name || newest.domain || 'İzləmə') + (extra > 0 ? ' və daha ' + extra + ' bildiriş' : '');
  chrome.notifications.create('visual-monitor-change-' + Date.now(), {
    type: 'basic',
    iconUrl: NOTIFICATION_ICON,
    title: 'Visual Monitor: yeni dəyişiklik',
    message,
    priority: 2,
  });
}

function updateBadge(payload, readIds) {
  const unreadItems = getUnreadItems(payload, readIds);
  const count = unreadItems.length;
  chrome.action.setBadgeBackgroundColor({ color: '#ef4444' });
  chrome.action.setBadgeText({ text: count > 0 ? String(Math.min(count, 99)) : '' });
  notifyNewChanges(unreadItems, previousUnreadCount);
  previousUnreadCount = count;
}

function refreshBadge() {
  chrome.storage.local.get([CHANGE_EVENTS_KEY, READ_EVENTS_KEY], (result) => {
    updateBadge(result[CHANGE_EVENTS_KEY], result[READ_EVENTS_KEY]);
  });
}

chrome.runtime.onInstalled.addListener(refreshBadge);
chrome.runtime.onStartup.addListener(refreshBadge);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (!changes[CHANGE_EVENTS_KEY] && !changes[READ_EVENTS_KEY]) return;
  refreshBadge();
});
