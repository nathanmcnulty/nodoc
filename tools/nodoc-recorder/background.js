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

function matchesPortalHost(portal, hostname) {
  const hostnames = portal.hostnames || (portal.hostname ? [portal.hostname] : []);
  if (hostnames.includes(hostname)) {
    return true;
  }

  const hostnameSuffixes = portal.hostnameSuffixes || [];
  return hostnameSuffixes.some(suffix => hostname.endsWith(suffix));
}

function isTrackedUrl(url) {
  try {
    const parsed = new URL(url);
    return portalConfig.some(portal =>
      matchesPortalHost(portal, parsed.hostname) &&
      portal.pathPrefixes.some(prefix => parsed.pathname.startsWith(prefix))
    );
  } catch {
    return false;
  }
}

// Intercept request bodies for tracked URLs
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (!isTrackedUrl(details.url)) {
      return;
    }

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
