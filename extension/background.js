function isGifUrl(url) {
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    return pathname.endsWith('.gif');
  } catch {
    return false;
  }
}

chrome.webRequest.onCompleted.addListener(
  async (details) => {
    if (details.tabId < 0) return; // ignore background/prefetch
    if (!isGifUrl(details.url)) return;

    const key = `tab_${details.tabId}`;
    const stored = await chrome.storage.local.get(key);
    const urls = new Set(stored[key] || []);
    urls.add(details.url);
    await chrome.storage.local.set({ [key]: [...urls] });
  },
  { urls: ['<all_urls>'] }
);

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') {
    chrome.storage.local.remove(`tab_${tabId}`);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.local.remove(`tab_${tabId}`);
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === 'getNetworkGifs') {
    const key = `tab_${message.tabId}`;
    chrome.storage.local.get(key).then((data) => {
      sendResponse({ urls: data[key] || [] });
    });
    return true; // keep message channel open for async response
  }
});
