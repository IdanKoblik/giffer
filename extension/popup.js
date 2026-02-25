// popup.js

// ── DOM scanning function (runs inside the page via scripting.executeScript) ──
function scanDomForGifs() {
  const urls = new Set();

  function addIfGif(raw) {
    if (!raw || typeof raw !== 'string') return;
    try {
      const href = new URL(raw.trim(), location.href).href;
      if (/\.gif(\?|#|$)/i.test(href)) urls.add(href);
    } catch { /* skip invalid URLs */ }
  }

  function parseUrlsFromCss(value) {
    if (!value) return;
    const re = /url\(\s*['"]?([^'")\s]+)['"]?\s*\)/gi;
    let m;
    while ((m = re.exec(value)) !== null) addIfGif(m[1]);
  }

  // <img src / srcset / data-* lazy-load attrs>
  document.querySelectorAll('img').forEach((el) => {
    addIfGif(el.src);
    addIfGif(el.dataset.src);
    addIfGif(el.dataset.original);
    addIfGif(el.dataset.lazy);
    addIfGif(el.dataset.gif);
    if (el.srcset) el.srcset.split(',').forEach(s => addIfGif(s.trim().split(/\s+/)[0]));
  });

  // <source> inside <picture>
  document.querySelectorAll('source').forEach((el) => {
    addIfGif(el.src);
    if (el.srcset) el.srcset.split(',').forEach(s => addIfGif(s.trim().split(/\s+/)[0]));
  });

  // <video src> (sites use video/gif replacements but sometimes still .gif)
  document.querySelectorAll('video').forEach((el) => {
    addIfGif(el.src);
    addIfGif(el.currentSrc);
  });

  // <link rel="preload" as="image">
  document.querySelectorAll('link[rel="preload"][as="image"]').forEach((el) => addIfGif(el.href));

  // <meta og:image / twitter:image>
  document.querySelectorAll('meta[property="og:image"], meta[name="twitter:image"]').forEach((el) => addIfGif(el.content));

  // Inline style background-image on every element
  document.querySelectorAll('[style]').forEach((el) => parseUrlsFromCss(el.getAttribute('style')));

  // <style> tags
  document.querySelectorAll('style').forEach((el) => parseUrlsFromCss(el.textContent));

  // All anchor hrefs pointing directly to .gif files
  document.querySelectorAll('a[href]').forEach((el) => addIfGif(el.getAttribute('href')));

  return [...urls];
}

let collectedUrls = []; // { url, sources: Set<'dom'|'net'> }

const btnScan  = document.getElementById('btn-scan');
const btnTxt   = document.getElementById('btn-txt');
const btnJson  = document.getElementById('btn-json');
const statusEl = document.getElementById('status');
const listEl   = document.getElementById('url-list');
const tooltip  = document.getElementById('tooltip');

btnScan.addEventListener('click', runScan);
btnTxt.addEventListener('click', () => downloadFile('txt'));
btnJson.addEventListener('click', () => downloadFile('json'));

async function runScan() {
  btnScan.disabled = true;
  btnTxt.disabled = true;
  btnJson.disabled = true;
  setStatus('Scanning…');
  listEl.innerHTML = '';

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    let domUrls = [];
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: scanDomForGifs,
      });
      domUrls = results[0]?.result || [];
    } catch (err) {
      console.warn('DOM scan failed:', err);
    }

    let netUrls = [];
    try {
      const resp = await chrome.runtime.sendMessage({ action: 'getNetworkGifs', tabId: tab.id });
      netUrls = resp?.urls || [];
    } catch (err) {
      console.warn('Network GIFs fetch failed:', err);
    }

    const map = new Map(); // url -> Set<source>
    domUrls.forEach(u => {
      if (!map.has(u)) map.set(u, new Set());
      map.get(u).add('dom');
    });
    netUrls.forEach(u => {
      if (!map.has(u)) map.set(u, new Set());
      map.get(u).add('net');
    });

    collectedUrls = [...map.entries()].map(([url, sources]) => ({ url, sources }));

    renderList(collectedUrls);
    setStatus(
      collectedUrls.length === 0
        ? 'No GIFs found on this page.'
        : `Found <span class="count">${collectedUrls.length}</span> GIF${collectedUrls.length !== 1 ? 's' : ''} &nbsp;·&nbsp; click a URL to copy`
    );

    if (collectedUrls.length > 0) {
      btnTxt.disabled = false;
      btnJson.disabled = false;
    }
  } catch (err) {
    setStatus(`Error: ${err.message}`);
    console.error(err);
  } finally {
    btnScan.disabled = false;
  }
}

function renderList(items) {
  if (items.length === 0) {
    listEl.innerHTML = '<div class="empty-state">No GIFs found on this page.</div>';
    return;
  }

  listEl.innerHTML = '';
  items.forEach(({ url, sources }) => {
    const div = document.createElement('div');
    div.className = 'url-item';
    div.title = 'Click to copy URL';

    const badgeEl = document.createElement('span');
    badgeEl.className = 'badge';
    if (sources.has('dom') && sources.has('net')) {
      badgeEl.className += ' badge-both';
      badgeEl.textContent = 'dom+net';
    } else if (sources.has('net')) {
      badgeEl.className += ' badge-net';
      badgeEl.textContent = 'net';
    } else {
      badgeEl.className += ' badge-dom';
      badgeEl.textContent = 'dom';
    }

    const span = document.createElement('span');
    span.className = 'url-text';
    span.textContent = url;

    div.appendChild(badgeEl);
    div.appendChild(span);
    div.addEventListener('click', () => copyToClipboard(url));
    listEl.appendChild(div);
  });
}

function setStatus(html) {
  statusEl.innerHTML = html;
}

function copyToClipboard(text) {
  navigator.clipboard.writeText(text).then(() => showTooltip('Copied!'));
}

function showTooltip(msg) {
  tooltip.textContent = msg;
  tooltip.classList.add('show');
  setTimeout(() => tooltip.classList.remove('show'), 1500);
}

function downloadFile(format) {
  if (collectedUrls.length === 0) return;
  const urls = collectedUrls.map(e => e.url);
  let content, mime, ext;

  if (format === 'json') {
    content = JSON.stringify(
      collectedUrls.map(({ url, sources }) => ({ url, sources: [...sources] })),
      null,
      2
    );
    mime = 'application/json';
    ext  = 'json';
  } else {
    content = urls.join('\n');
    mime = 'text/plain';
    ext  = 'txt';
  }

  const blob = new Blob([content], { type: mime });
  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = `gif-urls-${Date.now()}.${ext}`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
}
