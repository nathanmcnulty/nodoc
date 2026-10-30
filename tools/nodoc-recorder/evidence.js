/* Pure capture/export helpers shared by the DevTools panel and offline regressions. */
(function (root) {
  'use strict';
  const REDACTED = '[REDACTED]';
  const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  const stable = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
  function parseBody(value) {
    if (value === undefined || value === null) return { state: 'unavailable' };
    if (value === '') return { state: 'empty' };
    if (typeof value !== 'string') return { state: 'captured', value, json: true };
    try { return { state: 'captured', value: JSON.parse(value), json: true }; }
    catch { return { state: 'captured', value, json: false }; }
  }
  function decodeCapture(content, encoding) {
    if (content === null || content === undefined) return { responseBody: null, responseCapture: { state: 'unavailable', encoding: encoding || 'text' } };
    if (content.length > 2 * 1024 * 1024) return { responseBody: null, responseCapture: { state: 'omitted-size', encoding: encoding || 'text' } };
    try {
      const text = encoding === 'base64' ? new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(atob(content), char => char.charCodeAt(0))) : content;
      if (new TextEncoder().encode(text).length > 1024 * 1024) return { responseBody: null, responseCapture: { state: 'omitted-size', encoding: encoding || 'text' } };
      return { responseBody: text, responseCapture: { state: text === '' ? 'empty' : 'captured', encoding: encoding || 'text' } };
    } catch {
      return { responseBody: null, responseCapture: { state: 'decode-failed', encoding: encoding || 'text' } };
    }
  }
  function inferSchema(value, depth = 0) {
    if (depth > 20) return { 'x-nodoc-unknown': 'depth-limit' };
    if (value === null) return { nullable: true, 'x-nodoc-unknown': 'null-only' };
    if (Array.isArray(value)) return { type: 'array', items: value.reduce((schema, item) => mergeSchemas(schema, inferSchema(item, depth + 1)), undefined) || { 'x-nodoc-unknown': 'empty-array' } };
    if (typeof value === 'object') return { type: 'object', properties: Object.fromEntries(Object.keys(value).sort().map(key => [key, inferSchema(value[key], depth + 1)])) };
    if (typeof value === 'string') {
      const format = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) ? 'uuid'
        : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/i.test(value) ? 'date-time'
        : /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value) ? 'email' : /^https?:\/\//i.test(value) ? 'uri' : undefined;
      return { type: 'string', ...(format ? { format } : {}) };
    }
    return { type: typeof value === 'number' ? (Number.isInteger(value) ? 'integer' : 'number') : typeof value };
  }
  function mergeSchemas(left, right) {
    if (!left) return right;
    if (!right) return left;
    if (stable(left) === stable(right)) return left;
    if (left['x-nodoc-unknown'] === 'null-only' || right['x-nodoc-unknown'] === 'null-only') {
      const other = left['x-nodoc-unknown'] === 'null-only' ? right : left;
      return other.anyOf ? { anyOf: other.anyOf.map(schema => ({ ...schema, nullable: true })) } : { ...other, nullable: true };
    }
    if (left.type && left.type === right.type) {
      const result = { type: left.type, ...((left.nullable || right.nullable) ? { nullable: true } : {}) };
      if (left.type === 'object') {
        result.properties = Object.fromEntries([...new Set([...Object.keys(left.properties || {}), ...Object.keys(right.properties || {})])].sort().map(key => [key, mergeSchemas(left.properties?.[key], right.properties?.[key])]));
        if (left.additionalProperties || right.additionalProperties) result.additionalProperties = mergeSchemas(left.additionalProperties, right.additionalProperties);
        if (left['x-nodoc-redacted-key-count'] || right['x-nodoc-redacted-key-count']) {
          result['x-nodoc-redacted-key-count'] = Math.max(left['x-nodoc-redacted-key-count'] || 0, right['x-nodoc-redacted-key-count'] || 0);
          result['x-nodoc-dynamic-keys'] = 'observed-redacted-names; key-domain-unknown; count-is-maximum-per-observation';
        }
      }
      if (left.type === 'array') result.items = mergeSchemas(left.items, right.items);
      if (left.type === 'string' && left.format && left.format === right.format) result.format = left.format;
      return result;
    }
    if (['integer', 'number'].includes(left.type) && ['integer', 'number'].includes(right.type)) return { type: 'number', ...((left.nullable || right.nullable) ? { nullable: true } : {}) };
    let alternatives = [...(left.anyOf || [left]), ...(right.anyOf || [right])];
    if (alternatives.some(schema => schema.nullable)) alternatives = alternatives.map(schema => ({ ...schema, nullable: true }));
    const grouped = new Map();
    for (const schema of alternatives) {
      const key = ['integer', 'number'].includes(schema.type) ? 'numeric' : schema.type || stable(schema);
      grouped.set(key, grouped.has(key) ? mergeSchemas(grouped.get(key), schema) : schema);
    }
    return { anyOf: [...grouped.values()].sort((a, b) => stable(a).localeCompare(stable(b))) };
  }
  function serviceErrors(value, depth = 0) {
    if (depth > 8 || !value || typeof value !== 'object') return [];
    return Object.entries(value).flatMap(([key, item]) => /^(code|errorCode|error_code|message|error_description)$/i.test(key) && ['string', 'number'].includes(typeof item)
      ? [`${key}=${String(item).slice(0, 160)}`] : serviceErrors(item, depth + 1)).sort();
  }
  function mediaType(headers = {}) {
    const value = (Object.entries(headers).find(([key]) => key.toLowerCase() === 'content-type')?.[1] || 'application/json').split(';')[0].trim().toLowerCase();
    return /^[\w.+-]+\/[\w.+-]+$/.test(value) ? value : 'application/octet-stream';
  }
  function operationKey(entry) {
    try { const url = new URL(entry.url); return stable([url.origin, entry.method.toUpperCase(), url.pathname]); }
    catch { return stable(['invalid-url', entry.method, entry.path]); }
  }
  function variantKey(entry) {
    const url = new URL(entry.url);
    const request = parseBody(entry.requestBody), response = parseBody(entry.responseBody);
    return stable([operationKey(entry), [...new Set(url.searchParams.keys())].sort(), entry.statusCode,
      mediaType(entry.requestHeaders), mediaType(entry.responseHeaders), request.state, response.state,
      request.json ? inferSchema(request.value) : request.json, response.json ? inferSchema(response.value) : response.json,
      entry.statusCode >= 400 && typeof response.value === 'string' ? response.value : serviceErrors(response.value), entry.responseCapture?.state]);
  }
  // Export string values are never copied. Schemas are inferred from original private values first.
  function redactValue(value, depth = 0) {
    if (depth > 20) return REDACTED;
    if (Array.isArray(value)) return value.map(item => redactValue(item, depth + 1));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [safeName(key), redactValue(item, depth + 1)]));
    return typeof value === 'string' ? REDACTED : typeof value === 'number' ? 0 : value;
  }
  function safeName(value) {
    return /@|\b[0-9a-f]{8}-[0-9a-f-]{27,}\b|\beyJ[A-Za-z0-9_-]+\./i.test(value) ? '{redacted-key}' : value;
  }
  function publicOrigin(url) {
    // Keep exact known service hosts; unknown hosts may contain tenant/account names.
    const parsed = new URL(url);
    const known = new Set(['security.microsoft.com', 'admin.cloud.microsoft', 'admin.exchange.microsoft.com', 'exchange.admin.cloud.microsoft', 'admin.teams.microsoft.com', 'teams.microsoft.com', 'config.office.com', 'clients.config.office.net', 'query.inventory.insights.office.net', 'services.autopatch.microsoft.com', 'intune.microsoft.com', 'api.bap.microsoft.com', 'api.admin.powerplatform.microsoft.com', 'licensing.powerplatform.microsoft.com', 'purview.microsoft.com', 'api.securitycopilot.microsoft.com', 'api.securityplatform.microsoft.com', 'main.iam.ad.ext.azure.com', 'elm.iga.azure.com', 'api.azrbac.mspim.azure.com', 'api.accessreviews.identitygovernance.azure.com', 'main.b2cadmin.ext.azure.com']);
    if (!known.has(parsed.hostname) && !/(?:^|\.)example\.(?:com|net|org)$/.test(parsed.hostname)) {
      let hash = 2166136261;
      for (const char of parsed.origin) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
      return `https://origin-${(hash >>> 0).toString(16)}.invalid`;
    }
    return parsed.origin;
  }
  function publicPath(path) {
    // A route segment cannot generally be distinguished from a person's name.
    const known = new Set(['', 'api', 'apiproxy', 'admin', 'beta', 'users', 'groups', 'items', 'devices', 'tenants', 'settings', 'config', 'policies', 'reports', 'status', 'permissions', 'licenses', 'features', 'operations', 'jobs', 'results', 'data', 'search', 'query', 'count', '$count', '$batch', '_api']);
    return path.split('/').map((part, index) => known.has(part.toLowerCase()) || /^v\d+(?:\.\d+)?(?:-alpha|-beta)?$/i.test(part) ? part : `{redacted-segment-${index}}`).join('/');
  }
  function publicUrl(value) {
    try {
      const parsed = new URL(value);
      const query = [...parsed.searchParams.keys()].sort().map(key => `${encodeURIComponent(safeName(key))}=${encodeURIComponent(REDACTED)}`).join('&');
      return `${publicOrigin(value)}${publicPath(parsed.pathname)}${query ? '?' + query : ''}`;
    } catch { return REDACTED; }
  }
  function publicHeaders(headers = {}) {
    return Object.fromEntries(Object.entries(headers).map(([key, value]) => [safeName(key), key.toLowerCase() === 'content-type' && /^[\w.+-]+\/[\w.+-]+(?:\s*;\s*charset=[\w-]+)?$/i.test(value) ? value : REDACTED]));
  }
  function publicSchema(schema) {
    if (Array.isArray(schema)) return schema.map(publicSchema);
    if (!schema || typeof schema !== 'object') return schema;
    const result = Object.fromEntries(Object.entries(schema).filter(([key]) => key !== 'properties').map(([key, value]) => [key, publicSchema(value)]));
    if (schema.properties) {
      const entries = Object.entries(schema.properties);
      result.properties = Object.fromEntries(entries.filter(([key]) => safeName(key) === key).map(([key, value]) => [key, publicSchema(value)]));
      const redacted = entries.filter(([key]) => safeName(key) !== key);
      if (redacted.length) {
        result.additionalProperties = redacted.reduce((merged, [, value]) => mergeSchemas(merged, publicSchema(value)), result.additionalProperties);
        result['x-nodoc-redacted-key-count'] = redacted.length;
        result['x-nodoc-dynamic-keys'] = 'observed-redacted-names; key-domain-unknown; count-is-maximum-per-observation';
      }
    }
    return result;
  }
  function publicBody(raw, capture) {
    const parsed = parseBody(raw);
    const allowedReasons = ['size-limit', 'body-too-large', 'policy', 'excluded-by-policy', 'decode-failed', 'retrieval-failed', 'unavailable', 'empty', 'not-json', 'legacy-capture', 'response-not-finished', 'post-data-unavailable', 'no-post-data-reported', 'network-loading-failed', 'cdp-body-retrieval-failed', 'network-session-policy', 'encoded-size-limit-or-unknown', 'decoded-size-limit', 'body-unavailable', 'malformed-base64'];
    const reason = capture?.reason && allowedReasons.includes(capture.reason) ? capture.reason : capture?.reason ? 'unspecified' : undefined;
    const state = !capture?.state ? parsed.state : ['unknown', 'captured', 'empty', 'omitted', 'failed', 'omitted-size', 'decode-failed', 'unavailable'].includes(capture.state) ? capture.state : 'unknown';
    return { state, ...(capture?.encoding ? { encoding: ['utf8', 'base64', 'text', 'utf-8'].includes(capture.encoding) ? capture.encoding : 'unknown' } : {}),
      ...(reason ? { reason } : {}),
      ...(parsed.state === 'captured' ? { schema: publicSchema(inferSchema(parsed.value)), value: redactValue(parsed.value), json: parsed.json } : {}) };
  }
  function exportEntry(entry) {
    const url = publicUrl(entry.url);
    return { observationId: entry.id, method: entry.method, url, path: url.startsWith('http') ? new URL(url).pathname : REDACTED,
      portal: entry.portal, statusCode: entry.statusCode, timestamp: entry.timestamp,
      requestHeaders: publicHeaders(entry.requestHeaders), responseHeaders: publicHeaders(entry.responseHeaders),
      requestBody: publicBody(entry.requestBody, entry.requestCapture), responseBody: publicBody(entry.responseBody, entry.responseCapture),
      occurrences: entry.occurrences || 1, 'x-nodoc-redacted': true };
  }
  function buildOpenApiDocuments(entries, completeness) {
    const documents = new Map();
    const variantIds = new Map();
    const routePaths = new Map();
    const usedPaths = new Map();
    for (const entry of [...entries].sort((a, b) => operationKey(a).localeCompare(operationKey(b)) || String(a.id).localeCompare(String(b.id)))) {
      const parsedUrl = new URL(entry.url), rawOrigin = parsedUrl.origin, origin = publicOrigin(entry.url), method = entry.method.toLowerCase();
      const routeKey = stable([rawOrigin, parsedUrl.pathname]);
      if (!routePaths.has(routeKey)) {
        let candidate = publicPath(parsedUrl.pathname);
        const publicKey = stable([rawOrigin, candidate]);
        const sequence = (usedPaths.get(publicKey) || 0) + 1;
        usedPaths.set(publicKey, sequence);
        if (sequence > 1) candidate = candidate.replace(/\{redacted-segment-(\d+)\}/g, `{redacted-segment-$1-route-${sequence}}`);
        routePaths.set(routeKey, candidate);
      }
      const path = routePaths.get(routeKey);
      if (!documents.has(rawOrigin)) documents.set(rawOrigin, { openapi: '3.0.3', info: { title: 'nodoc observed API evidence', version: '0.0.1', description: 'Sanitized draft: review retained field/header/query names before publication. Unknown routes and origins are pseudonymized. Observed traffic only; requiredness, supported methods and error causes remain unverified.' }, servers: [{ url: origin }], paths: {} });
      const document = documents.get(rawOrigin);
      const methods = document.paths[path] ||= {};
      const operation = methods[method] ||= { summary: `${entry.method} ${path}`, 'x-nodoc-method-evidence': 'observed', 'x-nodoc-observations': [], responses: {} };
      const variant = variantKey(entry);
      if (!variantIds.has(variant)) variantIds.set(variant, `variant-${variantIds.size + 1}`);
      operation['x-nodoc-observations'].push({ ...exportEntry(entry), variantId: variantIds.get(variant) });
      const parameters = new URL(entry.url).searchParams;
      const queryParameters = [...new Set([...(operation.parameters || []).filter(item => item.in === 'query').map(item => item.name), ...[...parameters.keys()].map(safeName)])].sort().map(name => ({ name, in: 'query', required: false, schema: {}, 'x-nodoc-requiredness': 'unknown' }));
      const pathParameters = [...path.matchAll(/\{([^}]+)\}/g)].map(match => ({ name: match[1], in: 'path', required: true, schema: { type: 'string' }, 'x-nodoc-redacted': true }));
      operation.parameters = [...pathParameters, ...queryParameters];
      const status = /^\d{3}$/.test(String(entry.statusCode)) ? String(entry.statusCode) : 'default';
      const response = operation.responses[status] ||= { description: 'Observed response; HTTP status alone does not establish cause.' };
      for (const [side, headers, raw, capture] of [['response', entry.responseHeaders, entry.responseBody, entry.responseCapture], ['request', entry.requestHeaders, entry.requestBody, entry.requestCapture]]) {
        const body = publicBody(raw, capture);
        if (body.state !== 'captured') continue;
        const container = side === 'response' ? response : (operation.requestBody ||= { required: false, 'x-nodoc-requiredness': 'unknown' });
        const media = mediaType(headers);
        const content = container.content ||= {};
        const existing = content[media] ||= { schema: undefined };
        existing.schema = mergeSchemas(existing.schema, body.schema);
      }
    }
    if (completeness) for (const document of documents.values()) document['x-nodoc-capture-completeness'] = { limitReached: Boolean(completeness.limitReached), refusedObservationCount: Number(completeness.refusedObservationCount) || 0, observationLimit: 5000, byteLimit: 32 * 1024 * 1024, note: 'Only refused callbacks are counted; traffic while recording is paused is unobserved.' };
    return [...documents.values()];
  }
  // JSON is valid YAML 1.2, including a stream of separate origin-bound documents.
  const openApiYaml = (entries, completeness) => buildOpenApiDocuments(entries, completeness).map(document => JSON.stringify(document, null, 2)).join('\n---\n') + '\n';
  const api = { parseBody, decodeCapture, inferSchema, mergeSchemas, serviceErrors, operationKey, variantKey, publicUrl, exportEntry, buildOpenApiDocuments, openApiYaml };
  root.NodocRecorder = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
