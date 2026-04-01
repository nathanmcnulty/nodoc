/* nodoc-recorder — DevTools panel logic */

// ── Portal Configuration ──────────────────────────────────────────────
const portalConfig = [
  {
    id: 'defender-xdr',
    name: 'Defender XDR',
    hostname: 'security.microsoft.com',
    pathPrefixes: ['/apiproxy/'],
    urlPatterns: ['https://security.microsoft.com/apiproxy/*']
  },
  {
    id: 'm365-admin',
    name: 'M365 Admin',
    hostname: 'admin.cloud.microsoft',
    pathPrefixes: ['/admin/api/'],
    urlPatterns: ['https://admin.cloud.microsoft/admin/api/*']
  },
  {
    id: 'purview',
    name: 'Microsoft Purview',
    hostname: 'purview.microsoft.com',
    pathPrefixes: ['/apiproxy/'],
    urlPatterns: ['https://purview.microsoft.com/apiproxy/*']
  },
  {
    id: 'entra-iam',
    name: 'Entra IAM',
    hostname: 'main.iam.ad.ext.azure.com',
    pathPrefixes: ['/api/'],
    urlPatterns: ['https://main.iam.ad.ext.azure.com/api/*']
  },
  {
    id: 'entra-iga',
    name: 'Entra IGA',
    hostname: null,
    hostnames: ['elm.iga.azure.com', 'api.accessreviews.identitygovernance.azure.com'],
    pathPrefixes: ['/api/'],
    urlPatterns: [
      'https://elm.iga.azure.com/api/*',
      'https://api.accessreviews.identitygovernance.azure.com/*'
    ]
  }
];

// ── State ─────────────────────────────────────────────────────────────
let recording = true;
let selectedId = null;
let activeFilter = 'all';

// All captured requests keyed by a unique id
const capturedRequests = new Map();
// Deduplication: method+path → { count, latestId }
const deduplicationMap = new Map();
let nextId = 0;

// ── DOM refs ──────────────────────────────────────────────────────────
const btnRecord = document.getElementById('btn-record');
const btnClear = document.getElementById('btn-clear');
const btnExportYaml = document.getElementById('btn-export-yaml');
const btnExportJson = document.getElementById('btn-export-json');
const filterPortal = document.getElementById('filter-portal');
const requestCount = document.getElementById('request-count');
const requestTbody = document.getElementById('request-tbody');
const detailPane = document.getElementById('detail-pane');
const toast = document.getElementById('toast');

// ── Populate portal filter ────────────────────────────────────────────
for (const portal of portalConfig) {
  const opt = document.createElement('option');
  opt.value = portal.id;
  opt.textContent = portal.name;
  filterPortal.appendChild(opt);
}

// ── Helpers ───────────────────────────────────────────────────────────
function matchPortal(url) {
  try {
    const parsed = new URL(url);
    for (const portal of portalConfig) {
      const hostnames = portal.hostnames || (portal.hostname ? [portal.hostname] : []);
      for (const host of hostnames) {
        if (parsed.hostname === host) {
          for (const prefix of portal.pathPrefixes) {
            if (parsed.pathname.startsWith(prefix)) {
              return portal;
            }
          }
        }
      }
    }
  } catch {
    // ignore invalid URLs
  }
  return null;
}

function getPath(url) {
  try {
    const parsed = new URL(url);
    return parsed.pathname + parsed.search;
  } catch {
    return url;
  }
}

function dedupeKey(method, url) {
  // Normalize: strip query params and trailing slashes for dedup
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/\/+$/, '');
    return `${method} ${path}`;
  } catch {
    return `${method} ${url}`;
  }
}

function statusClass(code) {
  if (code >= 200 && code < 300) return 'status-2xx';
  if (code >= 300 && code < 400) return 'status-3xx';
  if (code >= 400 && code < 500) return 'status-4xx';
  if (code >= 500) return 'status-5xx';
  return '';
}

function statusText(code) {
  const texts = {
    200: 'OK', 201: 'Created', 204: 'No Content',
    301: 'Moved Permanently', 302: 'Found', 304: 'Not Modified',
    400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden',
    404: 'Not Found', 405: 'Method Not Allowed', 409: 'Conflict',
    429: 'Too Many Requests',
    500: 'Internal Server Error', 502: 'Bad Gateway', 503: 'Service Unavailable'
  };
  return texts[code] || '';
}

function formatTime(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2000);
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function headersToObject(headers) {
  const obj = {};
  if (Array.isArray(headers)) {
    for (const h of headers) {
      obj[h.name] = h.value;
    }
  }
  return obj;
}

function tryFormatJson(str) {
  if (!str) return str;
  try {
    return JSON.stringify(JSON.parse(str), null, 2);
  } catch {
    return str;
  }
}

// ── Build cURL command ────────────────────────────────────────────────
function buildCurl(entry) {
  const parts = [`curl '${entry.url}'`];
  if (entry.method !== 'GET') {
    parts.push(`  -X ${entry.method}`);
  }
  const reqHeaders = entry.requestHeaders || {};
  for (const [name, value] of Object.entries(reqHeaders)) {
    const lower = name.toLowerCase();
    if (lower === 'cookie' || lower === 'authorization') {
      parts.push(`  -H '${name}: [REDACTED]'`);
    } else {
      parts.push(`  -H '${name}: ${value}'`);
    }
  }
  if (entry.requestBody) {
    const bodyStr = typeof entry.requestBody === 'string'
      ? entry.requestBody
      : JSON.stringify(entry.requestBody);
    if (bodyStr && bodyStr !== '{}') {
      parts.push(`  --data-raw '${bodyStr.replace(/'/g, "'\\''")}'`);
    }
  }
  return parts.join(' \\\n');
}

// ── Capture request via network listener ──────────────────────────────
function captureRequest(request) {
  if (!recording) return;

  const url = request.request.url;
  const portal = matchPortal(url);
  if (!portal) return;

  const method = request.request.method;
  const id = `req-${nextId++}`;
  const path = getPath(url);
  const statusCode = request.response.status;
  const timestamp = Date.now();

  const entry = {
    id,
    method,
    url,
    path,
    portal: portal.id,
    portalName: portal.name,
    statusCode,
    timestamp,
    requestHeaders: headersToObject(request.request.headers),
    responseHeaders: headersToObject(request.response.headers),
    requestBody: null,
    responseBody: null,
    occurrences: 1
  };

  // Get response body
  request.getContent((content, encoding) => {
    if (content) {
      entry.responseBody = content;
    }
    finishCapture(entry);
  });
}

function finishCapture(entry) {
  // Try to get request body from background service worker
  // The request object from HAR doesn't carry the Chrome requestId directly,
  // so we also check postData from the HAR entry.
  if (entry.method !== 'GET' && entry.method !== 'HEAD') {
    // Attempt via background message (requestId isn't available from HAR,
    // but we store it as a fallback)
    // For HAR entries, use postData if available
  }

  // Deduplication
  const dk = dedupeKey(entry.method, entry.url);
  if (deduplicationMap.has(dk)) {
    const existing = deduplicationMap.get(dk);
    existing.count++;
    entry.occurrences = existing.count;
    // Remove old entry from capturedRequests
    capturedRequests.delete(existing.latestId);
    existing.latestId = entry.id;
  } else {
    deduplicationMap.set(dk, { count: 1, latestId: entry.id });
  }

  capturedRequests.set(entry.id, entry);
  updateCount();
  renderList();
}

// Also capture postData from HAR if available
const originalCapture = captureRequest;
function captureRequestWithPostData(harEntry) {
  if (!recording) return;

  const url = harEntry.request.url;
  const portal = matchPortal(url);
  if (!portal) return;

  const method = harEntry.request.method;
  const id = `req-${nextId++}`;
  const path = getPath(url);
  const statusCode = harEntry.response.status;
  const timestamp = Date.now();

  // Extract postData from HAR
  let requestBody = null;
  if (harEntry.request.postData) {
    requestBody = harEntry.request.postData.text || null;
  }

  const entry = {
    id,
    method,
    url,
    path,
    portal: portal.id,
    portalName: portal.name,
    statusCode,
    timestamp,
    requestHeaders: headersToObject(harEntry.request.headers),
    responseHeaders: headersToObject(harEntry.response.headers),
    requestBody,
    responseBody: null,
    occurrences: 1
  };

  harEntry.getContent((content, encoding) => {
    if (content) {
      entry.responseBody = content;
    }
    finishCapture(entry);
  });
}

// ── Network listener ──────────────────────────────────────────────────
chrome.devtools.network.onRequestFinished.addListener(captureRequestWithPostData);

// ── Rendering ─────────────────────────────────────────────────────────
function updateCount() {
  requestCount.textContent = capturedRequests.size;
}

function getFilteredRequests() {
  const entries = Array.from(capturedRequests.values());
  if (activeFilter === 'all') return entries;
  return entries.filter(e => e.portal === activeFilter);
}

function groupByPortal(entries) {
  const groups = new Map();
  for (const entry of entries) {
    if (!groups.has(entry.portal)) {
      groups.set(entry.portal, { name: entry.portalName, entries: [] });
    }
    groups.get(entry.portal).entries.push(entry);
  }
  return groups;
}

function renderList() {
  const filtered = getFilteredRequests();

  // Sort newest first
  filtered.sort((a, b) => b.timestamp - a.timestamp);

  const groups = groupByPortal(filtered);
  requestTbody.innerHTML = '';

  for (const [portalId, group] of groups) {
    // Group header
    if (activeFilter === 'all' && groups.size > 1) {
      const headerRow = document.createElement('tr');
      headerRow.className = 'group-header';
      headerRow.innerHTML = `<td colspan="5">${escapeHtml(group.name)} (${group.entries.length})</td>`;
      requestTbody.appendChild(headerRow);
    }

    for (const entry of group.entries) {
      const tr = document.createElement('tr');
      tr.dataset.id = entry.id;
      if (entry.id === selectedId) tr.className = 'selected';

      const dk = dedupeKey(entry.method, entry.url);
      const dedupInfo = deduplicationMap.get(dk);
      const count = dedupInfo ? dedupInfo.count : 1;
      const countBadge = count > 1 ? `<span class="occurrence-count">×${count}</span>` : '';

      tr.innerHTML = `
        <td><span class="method method-${entry.method}">${entry.method}</span></td>
        <td><span class="portal-tag">${escapeHtml(entry.portalName)}</span></td>
        <td title="${escapeHtml(entry.path)}">${escapeHtml(entry.path)}${countBadge}</td>
        <td><span class="${statusClass(entry.statusCode)}">${entry.statusCode}</span></td>
        <td>${formatTime(entry.timestamp)}</td>
      `;

      tr.addEventListener('click', () => selectRequest(entry.id));
      requestTbody.appendChild(tr);
    }
  }
}

function selectRequest(id) {
  selectedId = id;
  renderList();
  renderDetail();
}

function renderDetail() {
  const entry = capturedRequests.get(selectedId);
  if (!entry) {
    detailPane.className = 'detail-pane empty';
    detailPane.textContent = 'Select a request to view details';
    return;
  }

  detailPane.className = 'detail-pane';

  const reqHeaders = entry.requestHeaders || {};
  const resHeaders = entry.responseHeaders || {};

  const reqHeaderRows = Object.entries(reqHeaders).map(([k, v]) => {
    const lower = k.toLowerCase();
    const val = (lower === 'authorization' || lower === 'cookie') ? '[REDACTED]' : escapeHtml(v);
    return `<tr><td>${escapeHtml(k)}</td><td>${val}</td></tr>`;
  }).join('');

  const resHeaderRows = Object.entries(resHeaders).map(([k, v]) =>
    `<tr><td>${escapeHtml(k)}</td><td>${escapeHtml(v)}</td></tr>`
  ).join('');

  const formattedReqBody = entry.requestBody ? tryFormatJson(entry.requestBody) : null;
  const formattedResBody = entry.responseBody ? tryFormatJson(entry.responseBody) : null;

  detailPane.innerHTML = `
    <div class="detail-actions">
      <button id="btn-copy-curl" title="Copy as cURL command">Copy cURL</button>
      <button id="btn-copy-url" title="Copy URL">Copy URL</button>
    </div>

    <div class="detail-section">
      <h3>General</h3>
      <div class="url">${entry.method} <span class="${statusClass(entry.statusCode)}">${entry.statusCode} ${statusText(entry.statusCode)}</span></div>
      <div class="url" style="margin-top:4px">${escapeHtml(entry.url)}</div>
      <div style="margin-top:4px;color:#888">Portal: ${escapeHtml(entry.portalName)} · ${formatTime(entry.timestamp)}</div>
    </div>

    <div class="detail-section">
      <h3>Request Headers</h3>
      ${reqHeaderRows ? `<table class="header-table">${reqHeaderRows}</table>` : '<div style="color:#666">No headers captured</div>'}
    </div>

    ${formattedReqBody ? `
    <div class="detail-section">
      <h3>Request Body</h3>
      <pre>${escapeHtml(formattedReqBody)}</pre>
    </div>
    ` : ''}

    <div class="detail-section">
      <h3>Response Headers</h3>
      ${resHeaderRows ? `<table class="header-table">${resHeaderRows}</table>` : '<div style="color:#666">No headers captured</div>'}
    </div>

    ${formattedResBody ? `
    <div class="detail-section">
      <h3>Response Body</h3>
      <pre>${escapeHtml(formattedResBody)}</pre>
    </div>
    ` : ''}
  `;

  document.getElementById('btn-copy-curl').addEventListener('click', () => {
    copyToClipboard(buildCurl(entry));
    showToast('cURL copied to clipboard');
  });
  document.getElementById('btn-copy-url').addEventListener('click', () => {
    copyToClipboard(entry.url);
    showToast('URL copied to clipboard');
  });
}

// ── Clipboard ─────────────────────────────────────────────────────────
function copyToClipboard(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
  } else {
    fallbackCopy(text);
  }
}

function fallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.left = '-9999px';
  document.body.appendChild(ta);
  ta.select();
  document.execCommand('copy');
  document.body.removeChild(ta);
}

// ── Export: OpenAPI YAML ──────────────────────────────────────────────
function exportOpenApiYaml() {
  const entries = getFilteredRequests();
  if (entries.length === 0) {
    showToast('No requests to export');
    return;
  }

  // Group by deduplicated path
  const pathMap = new Map();
  for (const entry of entries) {
    let apiPath;
    try {
      const parsed = new URL(entry.url);
      apiPath = parsed.pathname;
    } catch {
      apiPath = entry.path;
    }

    if (!pathMap.has(apiPath)) {
      pathMap.set(apiPath, new Map());
    }
    const methods = pathMap.get(apiPath);
    // Keep latest per method
    methods.set(entry.method.toLowerCase(), entry);
  }

  const lines = [
    'openapi: "3.0.3"',
    'info:',
    '  title: nodoc-recorder Captured APIs',
    `  description: API traffic captured from Microsoft portals on ${new Date().toISOString().split('T')[0]}`,
    '  version: "0.0.1"',
    'paths:'
  ];

  // Sort paths alphabetically
  const sortedPaths = Array.from(pathMap.keys()).sort();

  for (const apiPath of sortedPaths) {
    const methods = pathMap.get(apiPath);
    lines.push(`  ${apiPath}:`);

    const sortedMethods = Array.from(methods.keys()).sort();
    for (const method of sortedMethods) {
      const entry = methods.get(method);
      const st = entry.statusCode;
      const stText = statusText(st) || 'Response';

      lines.push(`    ${method}:`);
      lines.push(`      summary: "${entry.method} ${apiPath}"`);
      lines.push(`      description: "Captured from ${entry.portalName}"`);

      // Tags
      lines.push(`      tags:`);
      lines.push(`        - ${entry.portalName}`);

      lines.push(`      responses:`);
      lines.push(`        '${st}':`);
      lines.push(`          description: "${st} ${stText}"`);

      // If we have a response body, try to infer content type
      const contentType = (entry.responseHeaders || {})['content-type'] || '';
      if (entry.responseBody && contentType) {
        const mediaType = contentType.split(';')[0].trim();
        lines.push(`          content:`);
        lines.push(`            ${mediaType}:`);
        lines.push(`              schema:`);
        lines.push(`                type: object`);
      }

      // If the method takes a body, indicate it
      if (['post', 'put', 'patch'].includes(method) && entry.requestBody) {
        const reqContentType = (entry.requestHeaders || {})['content-type'] ||
                               (entry.requestHeaders || {})['Content-Type'] || 'application/json';
        const reqMediaType = reqContentType.split(';')[0].trim();
        lines.push(`      requestBody:`);
        lines.push(`        content:`);
        lines.push(`          ${reqMediaType}:`);
        lines.push(`            schema:`);
        lines.push(`              type: object`);
      }
    }
  }

  const yaml = lines.join('\n') + '\n';
  downloadFile('nodoc-captured-openapi.yaml', yaml, 'text/yaml');
  showToast(`Exported ${sortedPaths.length} paths as OpenAPI YAML`);
}

// ── Export: JSON ──────────────────────────────────────────────────────
function exportJson() {
  const entries = getFilteredRequests();
  if (entries.length === 0) {
    showToast('No requests to export');
    return;
  }

  const exportData = {
    exportedAt: new Date().toISOString(),
    portalFilter: activeFilter,
    requestCount: entries.length,
    requests: entries.map(e => ({
      method: e.method,
      url: e.url,
      path: e.path,
      portal: e.portal,
      portalName: e.portalName,
      statusCode: e.statusCode,
      timestamp: e.timestamp,
      requestHeaders: e.requestHeaders,
      responseHeaders: e.responseHeaders,
      requestBody: e.requestBody,
      responseBody: e.responseBody,
      occurrences: e.occurrences
    }))
  };

  const json = JSON.stringify(exportData, null, 2);
  downloadFile('nodoc-captured-traffic.json', json, 'application/json');
  showToast(`Exported ${entries.length} requests as JSON`);
}

function downloadFile(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Event handlers ────────────────────────────────────────────────────
btnRecord.addEventListener('click', () => {
  recording = !recording;
  btnRecord.classList.toggle('active', recording);
  btnRecord.innerHTML = recording ? '&#9679; Record' : '&#9724; Paused';
  showToast(recording ? 'Recording resumed' : 'Recording paused');
});

btnClear.addEventListener('click', () => {
  capturedRequests.clear();
  deduplicationMap.clear();
  selectedId = null;
  updateCount();
  renderList();
  renderDetail();
  showToast('Cleared all requests');
});

btnExportYaml.addEventListener('click', exportOpenApiYaml);
btnExportJson.addEventListener('click', exportJson);

filterPortal.addEventListener('change', () => {
  activeFilter = filterPortal.value;
  renderList();
});

// ── Initial render ────────────────────────────────────────────────────
updateCount();
