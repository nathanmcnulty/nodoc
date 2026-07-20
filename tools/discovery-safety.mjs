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
