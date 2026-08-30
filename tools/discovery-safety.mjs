export const activeGetPathPattern =
  /(?:^|[/_-])(?:delete|execute|export|generate|invoke|log-?out|publish|remove|run|save|sign-?out|start|submit|sync|trigger)(?:$|[/_.?&=-])/iu;
export const activeGetQueryPattern =
  /(?:^|[?&])(?:action|command|operation)=(?:delete|execute|export|generate|invoke|publish|remove|run|save|start|submit|sync|trigger)(?:&|$)/iu;

function decodeRepeatedly(value) {
  let decoded = value;
  for (let pass = 0; pass < 3 && decoded.includes("%"); pass += 1) {
    decoded = decodeURIComponent(decoded);
  }
  return decoded;
}

export function classifyGetProbeUrl(value, baseUrl) {
  let target;
  let base;
  try {
    base = new URL(baseUrl);
    target = new URL(value, base);
  } catch {
    return { allowed: false, code: "invalid-url", url: null };
  }

  if (
    !["http:", "https:"].includes(target.protocol)
    || target.origin !== base.origin
    || target.username
    || target.password
  ) {
    return {
      allowed: false,
      code: "cross-origin-or-unsupported",
      url: target.toString(),
    };
  }

  let canonicalPath = target.pathname;
  let canonicalFragment = target.hash;
  try {
    canonicalPath = decodeRepeatedly(canonicalPath);
    canonicalFragment = decodeRepeatedly(canonicalFragment);
  } catch {
    return {
      allowed: false,
      code: "unsafe-encoding",
      url: target.toString(),
    };
  }

  let riskyQueryValue;
  try {
    riskyQueryValue = Array.from(target.searchParams).some(([key, queryValue]) => (
      ["action", "command", "operation"].includes(decodeRepeatedly(key).toLowerCase())
      && activeGetPathPattern.test(`/${decodeRepeatedly(queryValue)}`)
    ));
  } catch {
    return {
      allowed: false,
      code: "unsafe-encoding",
      url: target.toString(),
    };
  }

  if (
    activeGetPathPattern.test(canonicalPath)
    || activeGetPathPattern.test(canonicalFragment.replace(/^#/u, "/"))
    || activeGetQueryPattern.test(target.search)
    || activeGetQueryPattern.test(canonicalFragment)
    || riskyQueryValue
  ) {
    return {
      allowed: false,
      code: "active-get-denied",
      url: target.toString(),
    };
  }

  return {
    allowed: true,
    code: "allowed",
    url: target.toString(),
  };
}

export function sanitizeObservedTransportUrl(value) {
  try {
    const parsed = new URL(value);
    parsed.hash = "";
    parsed.username = "";
    parsed.password = "";
    for (const [key] of parsed.searchParams) {
      parsed.searchParams.set(key, "[redacted]");
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

function hostTemplateToRegex(hostTemplate) {
  const escaped = hostTemplate.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(
    `^${escaped
      .replace(/^\\\*\\\./u, "(?:[^.]+\\.)+")
      .replace(/\\\{[^}]+\\\}/gu, "[^.]+")}$`,
    "u",
  );
}

const tenantSafeServiceRoots = new Set([
  "azure.com",
  "cloud.microsoft",
  "dynamics.com",
  "microsoft.com",
  "microsoftonline.com",
  "office.com",
  "office.net",
  "powerapps.com",
  "powerplatform.com",
  "sharepoint.com",
  "windows.net",
]);
const tenantSafeServiceLabels = new Set([
  "admin",
  "api",
  "bap",
  "content",
  "crm",
  "ecs",
  "ext",
  "exchange",
  "graph",
  "identitygovernance",
  "insights",
  "inventory",
  "management",
  "maker",
  "makerx",
  "mspim",
  "portal",
  "powerapps",
  "powerplatform",
  "prod",
  "security",
  "securitycopilot",
  "securityplatform",
  "services",
  "static",
]);

export function sanitizeObservedHostFamily(value, trustedHostTemplates = []) {
  const hostname = String(value || "").trim().toLowerCase().replace(/\.$/u, "");
  if (
    !hostname
    || hostname.length > 253
    || !/^[a-z0-9.-]+$/u.test(hostname)
    || hostname.split(".").some((label) => (
      !label
      || label.length > 63
      || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u.test(label)
    ))
  ) {
    return "[redacted-host]";
  }

  const trustedTemplates = Array.from(new Set(
    trustedHostTemplates
      .map((template) => String(template || "").trim().toLowerCase().replace(/\.$/u, ""))
      .filter(Boolean),
  )).sort((left, right) => (
    right.replace(/\{[^}]+\}|\*/gu, "").length
    - left.replace(/\{[^}]+\}|\*/gu, "").length
    || left.localeCompare(right)
  ));
  const trustedMatch = trustedTemplates.find((template) => (
    hostTemplateToRegex(template).test(hostname)
  ));
  if (trustedMatch) {
    return trustedMatch;
  }

  const labels = hostname.split(".");
  if (labels.length < 2) {
    return "[redacted-host]";
  }

  const serviceRoot = labels.slice(-2).join(".");
  if (!tenantSafeServiceRoots.has(serviceRoot)) {
    return "[redacted-host]";
  }

  const serviceLabels = labels.slice(0, -2);
  if (serviceLabels.length === 0) {
    return `*.${serviceRoot}`;
  }

  return [
    ...serviceLabels.map((label) => (
      tenantSafeServiceLabels.has(label)
      || /^(?:ap|au|ca|eu|in|jp|uk|us)(?:\d+)?$/u.test(label)
        ? label
        : "{tenant}"
    )),
    serviceRoot,
  ].join(".");
}
