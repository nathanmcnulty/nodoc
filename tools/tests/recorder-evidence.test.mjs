import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const require = createRequire(import.meta.url);
const recorder = require('../nodoc-recorder/evidence.js');
const observation = (overrides = {}) => ({ id: 'req-1', url: 'https://api.example.com/api/v1/items', method: 'GET', statusCode: 200, requestBody: null, responseBody: '{"items":[{"name":"private"}]}', requestHeaders: {}, responseHeaders: { 'content-type': 'application/json' }, portal: 'test', timestamp: 1, ...overrides });

test('origin and same-shaped semantic errors remain distinct variants', () => {
  const first = observation({ statusCode: 404, responseBody: '{"error":{"code":"NoLicense","message":"private"}}' });
  const second = { ...first, id: 'req-2', responseBody: '{"error":{"code":"MissingResource","message":"private"}}' };
  assert.notEqual(recorder.variantKey(first), recorder.variantKey(second));
  assert.notEqual(recorder.operationKey(first), recorder.operationKey({ ...first, url: 'https://other.example.com/api/v1/items' }));
  const [document] = recorder.buildOpenApiDocuments([first, second]);
  const observations = document.paths['/api/v1/items'].get['x-nodoc-observations'];
  assert.equal(new Set(observations.map(item => item.variantId)).size, 2);
  assert.equal(observations.length, 2);
  const messageOnly = observation({ statusCode: 500, responseBody: '{"message":"No license"}' });
  assert.notEqual(recorder.variantKey(messageOnly), recorder.variantKey({ ...messageOnly, responseBody: '{"message":"No permission"}' }));
  assert.notEqual(recorder.variantKey({ ...messageOnly, responseBody: 'No license' }), recorder.variantKey({ ...messageOnly, responseBody: 'No permission' }));
});

test('OpenAPI retains every status/media variant with separate origin documents', () => {
  const entries = [observation(), observation({ id: 'req-2', statusCode: 500, responseBody: '{"error":{"code":"NoPermission"}}' }), observation({ id: 'req-3', responseBody: 'false', responseHeaders: { 'Content-Type': 'application/problem+json' } }), observation({ id: 'req-4', url: 'https://other.example.com/api/v1/items' })];
  const documents = recorder.buildOpenApiDocuments(entries);
  assert.equal(documents.length, 2);
  const get = documents[0].paths['/api/v1/items'].get;
  assert.deepEqual(Object.keys(get.responses), ['200', '500']);
  assert.equal(Object.keys(get.responses['200'].content).length, 2);
  assert.equal(get['x-nodoc-observations'].length, 3);
  assert.deepEqual(documents[0].servers, [{ url: 'https://api.example.com' }]);
  assert.deepEqual(recorder.buildOpenApiDocuments([...entries].reverse()), documents);
  assert.equal(recorder.openApiYaml(entries).split('\n---\n').length, 2);
});

test('inference preserves null uncertainty, primitives, heterogeneous types and unknown requirements', () => {
  assert.deepEqual(recorder.inferSchema([null, 42]), recorder.inferSchema([42, null]));
  assert.deepEqual(recorder.inferSchema([1, 'a']), recorder.inferSchema(['a', 1]));
  assert.deepEqual(recorder.inferSchema([1, 2.5, 'a']), recorder.inferSchema(['a', 1, 2.5]));
  assert.deepEqual(recorder.inferSchema([null, 1, 'a']), recorder.inferSchema(['a', 1, null]));
  assert.equal(recorder.inferSchema([]).items['x-nodoc-unknown'], 'empty-array');
  assert.equal(recorder.inferSchema(null)['x-nodoc-unknown'], 'null-only');
  assert.equal(recorder.parseBody('false').value, false);
  assert.equal(recorder.parseBody('0').value, 0);
  assert.equal(recorder.parseBody('null').value, null);
  assert.equal(recorder.inferSchema('person@example.com').format, 'email');
  const [document] = recorder.buildOpenApiDocuments([observation({ method: 'POST', requestBody: '0', requestHeaders: { 'Content-Type': 'application/json' } })]);
  const body = document.paths['/api/v1/items'].post.requestBody;
  assert.equal(body.required, false);
  assert.equal(body['x-nodoc-requiredness'], 'unknown');
  assert.equal(body.content['application/json'].schema.type, 'integer');
});

test('semantic error identity preserves structural location and complete captured suffixes', () => {
  const first = observation({ statusCode: 404, responseBody: JSON.stringify({ error: { code: 'A', inner: { code: 'B' } } }) });
  const swapped = { ...first, responseBody: JSON.stringify({ error: { code: 'B', inner: { code: 'A' } } }) };
  assert.notEqual(recorder.variantKey(first), recorder.variantKey(swapped));
  const prefix = 'x'.repeat(200);
  assert.notEqual(recorder.variantKey({ ...first, responseBody: JSON.stringify({ code: prefix + 'license' }) }), recorder.variantKey({ ...first, responseBody: JSON.stringify({ code: prefix + 'permission' }) }));
  assert.deepEqual(recorder.serviceErrors({ error: { code: 'A', inner: { code: 'B' } } }).map(item => JSON.parse(item)[0]), [['error', 'code'], ['error', 'inner', 'code']]);
});

test('semantic scan depth limit retains private error distinctions behind opaque export IDs', () => {
  function deepError(code, withShallowCode) {
    let nested = { code };
    for (let index = 0; index < 24; index++) nested = { nested };
    return withShallowCode ? { code: 'same-shallow-code', nested } : nested;
  }
  for (const shallow of [false, true]) {
    const first = observation({ statusCode: 500, responseBody: JSON.stringify(deepError('PRIVATE_DEEP_A', shallow)) });
    const second = observation({ id: 'req-2', statusCode: 500, responseBody: JSON.stringify(deepError('PRIVATE_DEEP_B', shallow)) });
    assert.deepEqual(recorder.inferSchema(JSON.parse(first.responseBody)), recorder.inferSchema(JSON.parse(second.responseBody)));
    assert.notEqual(recorder.variantKey(first), recorder.variantKey(second));
    const documents = recorder.buildOpenApiDocuments([first, second]);
    assert.equal(new Set(documents[0].paths['/api/v1/items'].get['x-nodoc-observations'].map(item => item.variantId)).size, 2);
    assert.equal(JSON.stringify(documents).includes('PRIVATE_DEEP_'), false);
  }
});

test('missing or invalid Content-Type remains unknown instead of asserting JSON', () => {
  for (const responseBody of ['plain text', '{"value":1}']) {
    const entry = observation({ responseBody, responseHeaders: {} });
    const exported = recorder.exportEntry(entry);
    assert.deepEqual(exported.responseMediaType, { value: 'application/octet-stream', state: 'unknown', reason: 'missing-content-type' });
    const content = recorder.buildOpenApiDocuments([entry])[0].paths['/api/v1/items'].get.responses['200'].content;
    assert.equal(content['application/json'], undefined);
    assert.deepEqual(content['application/octet-stream']['x-nodoc-media-type-evidence'], [exported.responseMediaType]);
  }
  assert.equal(recorder.exportEntry(observation({ responseHeaders: { 'Content-Type': 'not a media type' } })).responseMediaType.reason, 'invalid-content-type');
  assert.equal(recorder.exportEntry(observation()).responseMediaType.state, 'observed');
  assert.notEqual(recorder.variantKey(observation({ responseHeaders: {} })), recorder.variantKey(observation({ responseHeaders: { 'Content-Type': 'application/octet-stream' } })));
});

test('capture metadata normalization preserves producer enums and excludes arbitrary metadata', () => {
  assert.deepEqual(recorder.normalizeCaptureMetadata({ state: 'omitted-size', reason: 'decoded-size-limit', encoding: 'text', sampleTruncated: true, decodedBytes: 123, encodedDataLength: 200, private: 'secret' }), { state: 'omitted-size', reason: 'decoded-size-limit', encoding: 'text', sampleTruncated: true, decodedBytes: 123, encodedDataLength: 200 });
  assert.deepEqual(recorder.normalizeCaptureMetadata({ state: 'secret', reason: 'secret', encoding: 'secret', decodedBytes: -1 }), { state: 'unknown', reason: 'unspecified', encoding: 'unknown' });
  assert.equal(recorder.normalizeCaptureMetadata({ state: 'failed', reason: 'invalid-utf8', encoding: 'base64' }).reason, 'invalid-utf8');
});

test('copied cURL uses POSIX quoting on complete URL, method, header and body arguments', () => {
  const node = () => ({ appendChild() {}, addEventListener() {}, classList: { add() {}, remove() {}, toggle() {} }, dataset: {}, innerHTML: '', textContent: '', value: '' });
  const context = vm.createContext({ NodocRecorder: recorder, URL, Map, Set, Date, TextEncoder, document: { getElementById: node, createElement: node }, chrome: { devtools: { network: { onRequestFinished: { addListener() {} } } } }, setTimeout() {} });
  vm.runInContext(readFileSync(new URL('../nodoc-recorder/panel.js', import.meta.url), 'utf8'), context);
  const headerName = "x-'`touch${IFS}marker`'";
  context.entry = observation({ method: "POST'`marker`", url: "https://api.example.com/api/items?name'key=value", requestHeaders: { [headerName]: 'private' }, requestBody: JSON.stringify({ "field'`marker`": 'private' }) });
  const command = vm.runInContext('buildCurl(entry)', context);
  // Parse only POSIX single-quoted argument concatenation, without invoking a shell.
  function quotedArgument(text) {
    let output = '', index = 0;
    while (index < text.length) {
      if (text[index] === "'") {
        const end = text.indexOf("'", index + 1);
        assert.notEqual(end, -1, 'quoted argument closes');
        output += text.slice(index + 1, end); index = end + 1;
      } else if (text.slice(index, index + 2) === "\\'") {
        output += "'"; index += 2;
      } else assert.fail('unquoted shell syntax in argument: ' + text.slice(index));
    }
    return output;
  }
  const lines = command.split(' \\\n');
  assert.equal(quotedArgument(lines[0].replace(/^curl --url /, '')), recorder.publicUrl(context.entry.url));
  assert.equal(quotedArgument(lines[1].replace(/^  -X /, '')), context.entry.method);
  assert.equal(quotedArgument(lines[2].replace(/^  -H /, '')), headerName + ': [REDACTED]');
  assert.deepEqual(JSON.parse(quotedArgument(lines[3].replace(/^  --data-raw /, ''))), { "field'`marker`": '[REDACTED]' });
});

test('capture distinguishes empty, missing, oversized, malformed encoded and UTF-8 encoded bodies', () => {
  assert.equal(recorder.decodeCapture('').responseCapture.state, 'empty');
  assert.equal(recorder.decodeCapture(null).responseCapture.state, 'unavailable');
  assert.equal(recorder.decodeCapture('a'.repeat(1024 * 1024 + 1)).responseCapture.state, 'omitted-size');
  assert.equal(recorder.decodeCapture('not-base64!', 'base64').responseCapture.state, 'decode-failed');
  const encoded = Buffer.from('{"value":"é"}').toString('base64');
  assert.equal(recorder.decodeCapture(encoded, 'base64').responseBody, '{"value":"é"}');
  const [document] = recorder.buildOpenApiDocuments([observation({ responseBody: null, responseCapture: { state: 'omitted-size' } })]);
  assert.equal(document.paths['/api/v1/items'].get.responses['200'].content, undefined);
  assert.equal(document.paths['/api/v1/items'].get['x-nodoc-observations'][0].responseBody.state, 'omitted-size');
  assert.equal(recorder.exportEntry(observation({ responseBody: null, responseCapture: { state: 'omitted', reason: 'decoded-size-limit', encoding: 'utf8' } })).responseBody.reason, 'decoded-size-limit');
});

test('publishable outputs redact values in headers, URL, query, bodies and examples', () => {
  const secret = 'UNIQUE_PRIVATE_SECRET';
  const entry = observation({ url: `https://tenant-admin.sharepoint.com/api/v1/users/person%40example.com?token=${secret}#${secret}`, requestBody: JSON.stringify({ password: secret, accountId: 12345678 }), responseBody: JSON.stringify({ result: secret }), requestHeaders: { Authorization: `Bearer ${secret}`, 'X-Api-Key': secret, Cookie: secret }, responseHeaders: { 'Set-Cookie': secret, 'Content-Type': 'application/json' } });
  const serialized = JSON.stringify([recorder.exportEntry(entry), recorder.buildOpenApiDocuments([entry])]);
  for (const value of [secret, 'tenant-admin', 'person%40example.com', '12345678']) assert.equal(serialized.includes(value), false, value);
  assert.equal(recorder.exportEntry(entry).requestBody.schema.properties.accountId.type, 'integer');
  assert.equal(entry.requestHeaders.Cookie, secret, 'private observation remains intact');
  assert.equal(recorder.publicUrl('https://alice.api.powerplatform.com/users/alice').includes('alice'), false);
});

test('redacted paths retain distinct route bindings instead of merging unknown names', () => {
  const [document] = recorder.buildOpenApiDocuments([observation({ url: 'https://api.example.com/api/alpha' }), observation({ id: 'req-2', url: 'https://api.example.com/api/bravo' })]);
  assert.equal(Object.keys(document.paths).length, 2);
  assert.equal(JSON.stringify(document).includes('alpha'), false);
  for (const operation of Object.values(document.paths).map(item => item.get)) {
    assert.equal(operation.parameters[0].in, 'path');
    assert.equal(operation.parameters[0].required, true);
  }
});

test('redacted dynamic property names retain incompatible value shapes without literal key collisions', () => {
  const firstId = '11111111-1111-4111-8111-111111111111';
  const secondId = '22222222-2222-4222-8222-222222222222';
  const entry = observation({ responseBody: JSON.stringify({ [firstId]: 42, [secondId]: 'private' }) });
  const exported = recorder.exportEntry(entry).responseBody.schema;
  assert.deepEqual(exported.properties, {});
  assert.equal(exported['x-nodoc-redacted-key-count'], 2);
  assert.deepEqual(exported.additionalProperties.anyOf.map(schema => schema.type).sort(), ['integer', 'string']);
  const documents = recorder.buildOpenApiDocuments([entry, observation({ id: 'req-2', responseBody: JSON.stringify({ fixed: true, [firstId]: false }) })]);
  const merged = documents[0].paths['/api/v1/items'].get.responses['200'].content['application/json'].schema;
  assert.deepEqual(merged.additionalProperties.anyOf.map(schema => schema.type).sort(), ['boolean', 'integer', 'string']);
  assert.equal(merged['x-nodoc-redacted-key-count'], 2);
  assert.equal(merged.properties.fixed.type, 'boolean');
  const serialized = JSON.stringify([exported, documents]);
  assert.equal(serialized.includes(firstId), false);
  assert.equal(serialized.includes(secondId), false);
  assert.equal(Object.hasOwn(merged.properties, '{redacted-key}'), false);
});

test('panel preserves repeated immutable observations through its actual capture handler', () => {
  const node = () => ({ appendChild() {}, addEventListener() {}, classList: { add() {}, remove() {}, toggle() {} }, dataset: {}, innerHTML: '', textContent: '', value: '' });
  const context = vm.createContext({ NodocRecorder: recorder, URL, Map, Set, Date, TextEncoder, document: { getElementById: node, createElement: node }, chrome: { devtools: { network: { onRequestFinished: { addListener() {} } } } }, setTimeout() {} });
  vm.runInContext(readFileSync(new URL('../nodoc-recorder/panel.js', import.meta.url), 'utf8'), context);
  context.first = observation(); context.second = observation({ id: 'req-2' });
  vm.runInContext('finishCapture(first); finishCapture(second)', context);
  assert.equal(vm.runInContext('capturedRequests.size', context), 2);
  assert.equal(vm.runInContext('capturedRequests.get("req-1").occurrences', context), 1);
  assert.equal(vm.runInContext('capturedRequests.get("req-2").occurrences', context), 2);
  context.third = observation({ id: 'req-3' });
  vm.runInContext('capturedBytes = 32 * 1024 * 1024; finishCapture(third)', context);
  assert.equal(vm.runInContext('capturedRequests.size', context), 2);
  assert.equal(vm.runInContext('recording', context), false);
  const completeness = vm.runInContext('captureCompleteness()', context);
  assert.equal(completeness.limitReached, true);
  assert.equal(completeness.refusedObservationCount, 1);
  assert.equal(recorder.buildOpenApiDocuments([observation()], completeness)[0]['x-nodoc-capture-completeness'].limitReached, true);
});
