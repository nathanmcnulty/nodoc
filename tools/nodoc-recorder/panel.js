/* nodoc-recorder — DevTools panel logic */

// ── Portal Configuration ──────────────────────────────────────────────
const portalConfig = [
  {
    id: 'defender',
    name: 'Defender',
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
    id: 'exchange-beta',
    name: 'Exchange',
    hostname: 'admin.exchange.microsoft.com',
    pathPrefixes: ['/beta/'],
    urlPatterns: ['https://admin.exchange.microsoft.com/beta/*']
  },
  {
    id: 'sharepoint-admin',
    name: 'SharePoint',
    hostnameSuffixes: ['-admin.sharepoint.com'],
    pathPrefixes: ['/_api/'],
    urlPatterns: ['https://*.sharepoint.com/_api/*']
  },
  {
    id: 'teams',
    name: 'Teams',
    hostnames: [
      'admin.teams.microsoft.com',
      'noneu-admin.teams.microsoft.com',
      'teams.microsoft.com',
      'api.interfaces.records.teams.microsoft.com',
      'monitoringplatform.teams.microsoft.com',
      'uswest2.monitoringplatform.teams.microsoft.com',
      'config.teams.microsoft.com',
      'ehrconnectorsvc.teams.microsoft.com',
      'amer-ehrconnectorsvc.teams.microsoft.com',
      'vamonetization.teams.microsoft.com',
      'amer.vamonetization.teams.microsoft.com',
      'flworchestrator.teams.microsoft.com',
      'admin.devicemgmt.teams.microsoft.com',
      'monet.teams.microsoft.com',
      'reports.office.com',
      'reportsncu.office.com',
      'substrate.office.com',
      'cqd.teams.microsoft.com',
      'cqd.teams.cloud.microsoft',
      'collabinsights.teams.cloud.microsoft',
      'teams.cloud.microsoft',
      'amer.tags.teams.microsoft.com'
    ],
    pathPrefixes: [
      '/api/',
      '/admin/api/',
      '/amer/api/',
      '/data/',
      '/Teams.',
      '/Skype.',
      '/config/',
      '/repository/',
      '/AdminAppCatalog/teamsApps',
      '/internal/ux/',
      '/private/intraTenantConfig/',
      '/regionalDomainNameForTenant',
      '/haslicense',
      '/hasActiveCapabilities'
    ],
    urlPatterns: [
      'https://admin.teams.microsoft.com/api/*',
      'https://noneu-admin.teams.microsoft.com/api/*',
      'https://teams.microsoft.com/api/*',
      'https://api.interfaces.records.teams.microsoft.com/*',
      'https://monitoringplatform.teams.microsoft.com/api/*',
      'https://uswest2.monitoringplatform.teams.microsoft.com/api/*',
      'https://config.teams.microsoft.com/config/*',
      'https://ehrconnectorsvc.teams.microsoft.com/api/*',
      'https://amer-ehrconnectorsvc.teams.microsoft.com/api/*',
      'https://vamonetization.teams.microsoft.com/*',
      'https://amer.vamonetization.teams.microsoft.com/*',
      'https://flworchestrator.teams.microsoft.com/amer/api/*',
      'https://admin.devicemgmt.teams.microsoft.com/api/*',
      'https://admin.devicemgmt.teams.microsoft.com/admin/api/*',
      'https://monet.teams.microsoft.com/api/*',
      'https://reports.office.com/private/intraTenantConfig/*',
      'https://reportsncu.office.com/internal/ux/*',
      'https://substrate.office.com/AdminAppCatalog/teamsApps*',
      'https://cqd.teams.microsoft.com/repository/*',
      'https://cqd.teams.cloud.microsoft/data/*',
      'https://collabinsights.teams.cloud.microsoft/amer/api/*',
      'https://teams.cloud.microsoft/api/*',
      'https://amer.tags.teams.microsoft.com/api/*'
    ]
  },
  {
    id: 'm365-apps-config',
    name: 'M365 Apps Config',
    hostname: 'config.office.com',
    pathPrefixes: [
      '/appConfig/',
      '/endpointprovisionhealth/',
      '/intents/',
      '/policyadmin/',
      '/releases/',
      '/rollout/',
      '/serviceProfile/',
      '/ServiceProfile/',
      '/settings/'
    ],
    urlPatterns: ['https://config.office.com/*']
  },
  {
    id: 'm365-apps-services',
    name: 'M365 Apps Services',
    hostname: 'clients.config.office.net',
    pathPrefixes: ['/intents/', '/odbhealth/', '/onboarding/', '/releases/'],
    urlPatterns: ['https://clients.config.office.net/*']
  },
  {
    id: 'm365-apps-inventory',
    name: 'M365 Apps Inventory',
    hostname: 'query.inventory.insights.office.net',
    pathPrefixes: ['/inventory/'],
    urlPatterns: ['https://query.inventory.insights.office.net/*']
  },
  {
    id: 'intune-autopatch',
    name: 'Intune Autopatch',
    hostname: 'services.autopatch.microsoft.com',
    pathPrefixes: [
      '/api/',
      '/tenant-management/',
      '/update-management/',
      '/access-control/',
      '/device/',
      '/unified-reporting/',
      '/reporting/',
      '/support/'
    ],
    urlPatterns: ['https://services.autopatch.microsoft.com/*']
  },
  {
    id: 'intune-portal',
    name: 'Intune Portal',
    hostname: 'intune.microsoft.com',
    pathPrefixes: ['/api/'],
    urlPatterns: ['https://intune.microsoft.com/api/*']
  },
  {
    id: 'power-platform',
    name: 'Power Platform',
    hostnames: [
      'api.bap.microsoft.com',
      'api.admin.powerplatform.microsoft.com',
      'licensing.powerplatform.microsoft.com'
    ],
    hostnameSuffixes: [
      '.adminanalytics.powerplatform.microsoft.com',
      '.csanalytics.powerplatform.microsoft.com',
      '.tenant.api.powerplatform.com',
      '.crm.dynamics.com',
      '.portal-infra.dynamics.com'
    ],
    pathPrefixes: ['/providers/', '/api/', '/analytics/', '/governance/', '/notificationservice/', '/v0.1', '/v0.1-alpha', '/v1.0', '/api/data/', '/api/nosql/', '/api/v1/'],
    urlPatterns: [
      'https://api.bap.microsoft.com/*',
      'https://api.admin.powerplatform.microsoft.com/*',
      'https://licensing.powerplatform.microsoft.com/*',
      'https://*.adminanalytics.powerplatform.microsoft.com/*',
      'https://*.csanalytics.powerplatform.microsoft.com/*',
      'https://*.tenant.api.powerplatform.com/*',
      'https://*.crm.dynamics.com/api/data/*',
      'https://*.crm.dynamics.com/api/nosql/*',
      'https://*.portal-infra.dynamics.com/api/v1/*'
    ]
  },
  {
    id: 'purview',
    name: 'Purview',
    hostname: 'purview.microsoft.com',
    pathPrefixes: ['/apiproxy/'],
    urlPatterns: ['https://purview.microsoft.com/apiproxy/*']
  },
  {
    id: 'purview-portal',
    name: 'Purview Portal',
    hostname: 'purview.microsoft.com',
    pathPrefixes: ['/api/'],
    urlPatterns: ['https://purview.microsoft.com/api/*']
  },
  {
    id: 'security-copilot',
    name: 'Security Copilot',
    hostnames: [
      'api.securitycopilot.microsoft.com',
      'api.securityplatform.microsoft.com',
      'prod.cds.securitycopilot.microsoft.com',
      'securitymarketplaceapi-prod.microsoft.com',
      'ecs.office.com'
    ],
    hostnameSuffixes: [
      '.api.securityplatform.microsoft.com'
    ],
    pathPrefixes: [
      '/auth',
      '/users/',
      '/settings/',
      '/userPreferences/',
      '/usage/',
      '/graphData/',
      '/provisioning/',
      '/account/',
      '/api/gateway/',
      '/pods/',
      '/trial',
      '/catalog/',
      '/config/v1/SecurityMarketplaceClient/'
    ],
    urlPatterns: [
      'https://api.securitycopilot.microsoft.com/*',
      'https://api.securityplatform.microsoft.com/*',
      'https://*.api.securityplatform.microsoft.com/*',
      'https://prod.cds.securitycopilot.microsoft.com/*',
      'https://securitymarketplaceapi-prod.microsoft.com/*',
      'https://ecs.office.com/config/v1/SecurityMarketplaceClient/*'
    ]
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
    hostname: 'elm.iga.azure.com',
    pathPrefixes: ['/api/'],
    urlPatterns: ['https://elm.iga.azure.com/api/*']
  },
  {
    id: 'entra-pim',
    name: 'Entra PIM',
    hostname: 'api.azrbac.mspim.azure.com',
    pathPrefixes: ['/api/'],
    urlPatterns: ['https://api.azrbac.mspim.azure.com/api/*']
  },
  {
    id: 'entra-idgov',
    name: 'Entra IDGov',
    hostname: 'api.accessreviews.identitygovernance.azure.com',
    pathPrefixes: ['/accessReviews/'],
    urlPatterns: ['https://api.accessreviews.identitygovernance.azure.com/*']
  },
  {
    id: 'entra-b2c',
    name: 'Entra B2C',
    hostname: 'main.b2cadmin.ext.azure.com',
    pathPrefixes: ['/api/'],
    urlPatterns: ['https://main.b2cadmin.ext.azure.com/api/*']
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
function matchesPortalHost(portal, hostname) {
  const hostnames = portal.hostnames || (portal.hostname ? [portal.hostname] : []);
  if (hostnames.includes(hostname)) {
    return true;
  }

  const hostnameSuffixes = portal.hostnameSuffixes || [];
  return hostnameSuffixes.some(suffix => hostname.endsWith(suffix));
}

function matchPortal(url) {
  try {
    const parsed = new URL(url);
    for (const portal of portalConfig) {
      if (!matchesPortalHost(portal, parsed.hostname)) {
        continue;
      }

      for (const prefix of portal.pathPrefixes) {
        if (parsed.pathname.startsWith(prefix)) {
          return portal;
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

function yamlIndent(level) {
  return '  '.repeat(level);
}

function yamlKey(key) {
  return /^[A-Za-z_][A-Za-z0-9_.-]*$/.test(key) ? key : JSON.stringify(key);
}

function yamlScalar(value) {
  if (value === null) return 'null';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(String(value));
}

function parseMaybeJson(value) {
  if (value === null || typeof value === 'undefined') return null;
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function detectStringFormat(value) {
  if (typeof value !== 'string') return undefined;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    return 'uuid';
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/i.test(value)) {
    return 'date-time';
  }
  if (/^https?:\/\//i.test(value)) {
    return 'uri';
  }
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) {
    return 'email';
  }
  return undefined;
}

function inferPrimitiveSchema(value) {
  if (value === null) {
    return {
      type: 'string',
      nullable: true,
      example: null,
    };
  }
  if (typeof value === 'boolean') {
    return { type: 'boolean', example: value };
  }
  if (typeof value === 'number') {
    return {
      type: Number.isInteger(value) ? 'integer' : 'number',
      example: value,
    };
  }
  if (typeof value === 'string') {
    const schema = {
      type: 'string',
      example: value.length > 160 ? `${value.slice(0, 157)}...` : value,
    };
    const format = detectStringFormat(value);
    if (format) {
      schema.format = format;
    }
    return schema;
  }
  return { type: 'string' };
}

function mergeSchemas(base, next) {
  if (!base) return next;
  if (!next) return base;

  const merged = { ...base };
  if (base.nullable || next.nullable) {
    merged.nullable = true;
  }

  if (base.type !== next.type) {
    if (
      (base.type === 'integer' && next.type === 'number') ||
      (base.type === 'number' && next.type === 'integer')
    ) {
      return { ...merged, type: 'number' };
    }
    return merged;
  }

  if (base.type === 'object') {
    merged.properties = { ...(base.properties || {}) };
    for (const [key, value] of Object.entries(next.properties || {})) {
      merged.properties[key] = mergeSchemas(merged.properties[key], value);
    }
    return merged;
  }

  if (base.type === 'array') {
    return {
      ...merged,
      items: mergeSchemas(base.items, next.items),
    };
  }

  if (base.type === 'string' && base.format !== next.format) {
    delete merged.format;
  }

  return merged;
}

function inferSchema(value) {
  if (Array.isArray(value)) {
    let itemSchema = null;
    for (const item of value.slice(0, 10)) {
      itemSchema = mergeSchemas(itemSchema, inferSchema(item));
    }
    return {
      type: 'array',
      items: itemSchema || { type: 'object' },
    };
  }

  if (value && typeof value === 'object') {
    const properties = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      properties[key] = inferSchema(nestedValue);
    }
    return {
      type: 'object',
      properties,
    };
  }

  return inferPrimitiveSchema(value);
}

function appendSchemaLines(lines, indent, schema) {
  const prefix = yamlIndent(indent);
  if (!schema) {
    lines.push(`${prefix}type: object`);
    return;
  }

  if (schema.type) {
    lines.push(`${prefix}type: ${schema.type}`);
  }
  if (schema.format) {
    lines.push(`${prefix}format: ${schema.format}`);
  }
  if (schema.nullable) {
    lines.push(`${prefix}nullable: true`);
  }
  if (
    Object.prototype.hasOwnProperty.call(schema, 'example') &&
    (typeof schema.example !== 'object' || schema.example === null)
  ) {
    lines.push(`${prefix}example: ${yamlScalar(schema.example)}`);
  }
  if (schema.properties && Object.keys(schema.properties).length > 0) {
    lines.push(`${prefix}properties:`);
    for (const [key, value] of Object.entries(schema.properties)) {
      lines.push(`${yamlIndent(indent + 1)}${yamlKey(key)}:`);
      appendSchemaLines(lines, indent + 2, value);
    }
  }
  if (schema.items) {
    lines.push(`${prefix}items:`);
    appendSchemaLines(lines, indent + 1, schema.items);
  }
}

function inferQueryParamSchema(value) {
  if (value === 'true' || value === 'false') {
    return { type: 'boolean', example: value === 'true' };
  }
  if (/^-?\d+$/.test(value)) {
    return { type: 'integer', example: Number(value) };
  }
  if (/^-?\d+\.\d+$/.test(value)) {
    return { type: 'number', example: Number(value) };
  }
  return inferPrimitiveSchema(value);
}

function appendQueryParameters(lines, entry, indent) {
  try {
    const parsed = new URL(entry.url);
    const params = Array.from(parsed.searchParams.entries());
    if (params.length === 0) return;

    lines.push(`${yamlIndent(indent)}parameters:`);
    for (const [name, value] of params) {
      const schema = inferQueryParamSchema(value);
      lines.push(`${yamlIndent(indent + 1)}- name: ${yamlScalar(name)}`);
      lines.push(`${yamlIndent(indent + 2)}in: query`);
      lines.push(`${yamlIndent(indent + 2)}required: false`);
      lines.push(`${yamlIndent(indent + 2)}schema:`);
      appendSchemaLines(lines, indent + 3, schema);
    }
  } catch {
    // Ignore invalid URLs during export.
  }
}

function getMediaType(headers, fallback) {
  const headerValue = headers['content-type'] || headers['Content-Type'] || fallback;
  return (headerValue || fallback || 'application/json').split(';')[0].trim();
}

function buildOperationId(entry, apiPath) {
  const raw = `${entry.portal}_${entry.method.toLowerCase()}_${apiPath}`
    .replace(/^\//, '')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return raw || `${entry.portal}_${entry.method.toLowerCase()}`;
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
  const servers = new Set();
  for (const entry of entries) {
    let apiPath;
    try {
      const parsed = new URL(entry.url);
      apiPath = parsed.pathname;
      servers.add(`${parsed.protocol}//${parsed.host}`);
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
    `  description: ${yamlScalar(`API traffic captured from Microsoft portals on ${new Date().toISOString().split('T')[0]}`)}`,
    '  version: "0.0.1"',
  ];

  if (servers.size > 0) {
    lines.push('servers:');
    Array.from(servers).sort().forEach((server) => {
      lines.push(`  - url: ${yamlScalar(server)}`);
    });
  }

  lines.push('paths:');

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
      const responseMediaType = getMediaType(entry.responseHeaders || {}, 'application/json');
      const requestMediaType = getMediaType(entry.requestHeaders || {}, 'application/json');
      const parsedResponseBody = parseMaybeJson(entry.responseBody);
      const parsedRequestBody = parseMaybeJson(entry.requestBody);
      const responseSchema = parsedResponseBody ? inferSchema(parsedResponseBody) : { type: 'object' };
      const requestSchema = parsedRequestBody ? inferSchema(parsedRequestBody) : { type: 'object' };

      lines.push(`    ${method}:`);
      lines.push(`      operationId: ${buildOperationId(entry, apiPath)}`);
      lines.push(`      summary: ${yamlScalar(`${entry.method} ${apiPath}`)}`);
      lines.push(`      description: ${yamlScalar(`Captured from ${entry.portalName}`)}`);

      // Tags
      lines.push(`      tags:`);
      lines.push(`        - ${yamlScalar(entry.portalName)}`);

      appendQueryParameters(lines, entry, 3);

      lines.push(`      responses:`);
      lines.push(`        '${st}':`);
      lines.push(`          description: ${yamlScalar(`${st} ${stText}`)}`);

      if (entry.responseBody) {
        lines.push(`          content:`);
        lines.push(`            ${responseMediaType}:`);
        lines.push(`              schema:`);
        appendSchemaLines(lines, 8, responseSchema);
      }

      if (['post', 'put', 'patch'].includes(method) && entry.requestBody) {
        lines.push(`      requestBody:`);
        lines.push(`        required: true`);
        lines.push(`        content:`);
        lines.push(`          ${requestMediaType}:`);
        lines.push(`            schema:`);
        appendSchemaLines(lines, 7, requestSchema);
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
