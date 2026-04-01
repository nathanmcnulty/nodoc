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
    id: 'purview',
    name: 'Purview',
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
  }
];

// Build a list of tracked URL prefixes from portalConfig
const trackedPrefixes = [];
for (const portal of portalConfig) {
  for (const pattern of portal.urlPatterns) {
    trackedPrefixes.push(pattern.replace('*', ''));
  }
}

// Store intercepted request bodies with a 5-minute TTL
const requestBodyMap = new Map();
const BODY_TTL_MS = 5 * 60 * 1000;

function pruneExpiredBodies() {
  const now = Date.now();
  for (const [key, entry] of requestBodyMap) {
    if (now - entry.timestamp > BODY_TTL_MS) {
      requestBodyMap.delete(key);
    }
  }
}

// Prune every 60 seconds
setInterval(pruneExpiredBodies, 60_000);

function isTrackedUrl(url) {
  return trackedPrefixes.some(prefix => url.startsWith(prefix));
}

// Intercept request bodies for tracked URLs
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (details.requestBody) {
      const body = {};
      if (details.requestBody.raw) {
        try {
          const decoder = new TextDecoder('utf-8');
          const parts = details.requestBody.raw.map(part => {
            if (part.bytes) {
              return decoder.decode(part.bytes);
            }
            return '';
          });
          body.raw = parts.join('');
        } catch {
          body.raw = '[binary data]';
        }
      }
      if (details.requestBody.formData) {
        body.formData = details.requestBody.formData;
      }
      requestBodyMap.set(details.requestId, {
        body,
        timestamp: Date.now()
      });
    }
  },
  { urls: portalConfig.flatMap(p => p.urlPatterns) },
  ['requestBody']
);

// Handle messages from the DevTools panel
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_REQUEST_BODY') {
    const entry = requestBodyMap.get(message.requestId);
    sendResponse({ body: entry ? entry.body : null });
    return true;
  }

  if (message.type === 'GET_COOKIE') {
    chrome.cookies.getAll({ domain: message.domain }, (cookies) => {
      if (message.name) {
        const cookie = cookies.find(c => c.name === message.name);
        sendResponse({ cookie: cookie ? cookie.value : null });
      } else {
        sendResponse({ cookies });
      }
    });
    return true;
  }

  if (message.type === 'GET_PORTAL_CONFIG') {
    sendResponse({ portalConfig });
    return true;
  }
});
