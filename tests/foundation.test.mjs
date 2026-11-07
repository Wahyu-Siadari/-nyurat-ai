import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { projectDraftSchema, ServiceError } from '../src/lib/contract.ts';
import { createInitialProject, invalidateInput, validateLayout } from '../src/lib/project.ts';
import { DEFAULT_GEMINI_MODEL, getConfig, parseConfig, resetConfigForTests } from '../src/server/config.ts';
import { createPostHandler, methodNotAllowed, notFound, successResponse } from '../src/server/http/envelope.ts';
import { ApiError, ERROR_CATALOG, toApiError } from '../src/server/http/errors.ts';
import { MAX_JSON_BODY_BYTES, parseProjectRequest } from '../src/server/http/parse-project.ts';
import { clientKey, createRateLimiter, rateLimiter } from '../src/server/http/rate-limit.ts';

function projectFor(name = 'Warung Sari') {
  return invalidateInput(createInitialProject(), { latinName: name, businessType: 'warung', sourceLanguage: 'id' });
}

function payloadFor(project) {
  return { schemaVersion: '0.1-draft', projectId: project.projectId, revision: project.revision, project };
}

function jsonRequest(body, headers = {}) {
  return new Request('http://nyurat.test/api/v1/x', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
}

async function rejectsWith(promise, code, status) {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.code, code);
    assert.equal(error.status, status);
    return true;
  });
}

function assertErrorEnvelope(body, code) {
  assert.equal(body.ok, false);
  assert.equal(body.schemaVersion, '0.1-draft');
  assert.equal(typeof body.requestId, 'string');
  assert.equal(body.error.code, code);
  assert.equal(typeof body.error.message, 'string');
  assert.equal(typeof body.error.retryable, 'boolean');
}

test('config applies defaults and treats a blank key as absent', () => {
  assert.deepEqual(parseConfig({ GEMINI_API_KEY: '   ' }), { geminiApiKey: null, geminiModel: DEFAULT_GEMINI_MODEL, rateLimitPerMinute: 30, mode: 'live' });
});

test('config reads every variable', () => {
  const config = parseConfig({ GEMINI_API_KEY: 'k', GEMINI_MODEL: 'gemini-x-1.0', NYURAT_RATE_LIMIT_PER_MIN: '12', NYURAT_MODE: 'fixture' });
  assert.deepEqual(config, { geminiApiKey: 'k', geminiModel: 'gemini-x-1.0', rateLimitPerMinute: 12, mode: 'fixture' });
});

test('config names the bad variable without echoing any value', () => {
  assert.throws(() => parseConfig({ GEMINI_API_KEY: 'rahasia-sekali', NYURAT_MODE: 'demo' }), (error) => {
    assert.match(error.message, /NYURAT_MODE/);
    assert.doesNotMatch(error.message, /rahasia-sekali|demo/);
    return true;
  });
});

test('config rejects a rate limit too small for one weighted photo audit', () => {
  assert.throws(() => parseConfig({ NYURAT_RATE_LIMIT_PER_MIN: '2' }), /NYURAT_RATE_LIMIT_PER_MIN/);
});

test('getConfig reads the environment once', (t) => {
  resetConfigForTests();
  t.after(() => { delete process.env.NYURAT_RATE_LIMIT_PER_MIN; resetConfigForTests(); });
  process.env.NYURAT_RATE_LIMIT_PER_MIN = '11';
  assert.equal(getConfig().rateLimitPerMinute, 11);
  process.env.NYURAT_RATE_LIMIT_PER_MIN = '12';
  assert.equal(getConfig().rateLimitPerMinute, 11);
});

test('error catalog matches the published status and retry table', () => {
  const expected = {
    INVALID_INPUT: [400, false], STALE_REVISION: [409, false], PAYLOAD_TOO_LARGE: [413, false], UNSUPPORTED_MEDIA_TYPE: [415, false],
    RATE_LIMITED: [429, true], QUOTA_EXHAUSTED: [429, true], AI_TIMEOUT: [504, true], UPSTREAM_UNAVAILABLE: [503, true],
    EXPORT_FAILED: [500, true], INTERNAL_ERROR: [500, true], NOT_FOUND: [404, false], METHOD_NOT_ALLOWED: [405, false],
  };
  assert.deepEqual(Object.keys(ERROR_CATALOG).sort(), Object.keys(expected).sort());
  for (const [code, [status, retryable]] of Object.entries(expected)) {
    assert.equal(ERROR_CATALOG[code].status, status, code);
    assert.equal(ERROR_CATALOG[code].retryable, retryable, code);
  }
});

test('unknown errors never expose their message; known service errors keep theirs', () => {
  const hidden = toApiError(new Error('gagal baca C:/rahasia/.env'));
  assert.equal(hidden.code, 'INTERNAL_ERROR');
  assert.doesNotMatch(hidden.message, /rahasia/);
  const known = toApiError(new ServiceError('EXPORT_FAILED', 'Simulasi gagal.'));
  assert.equal(known.code, 'EXPORT_FAILED');
  assert.equal(known.message, 'Simulasi gagal.');
  assert.equal(toApiError(new ServiceError('LAINNYA', 'x')).code, 'INTERNAL_ERROR');
});

test('success envelope carries identity, no-store, and the request id header', async () => {
  const response = successResponse('req-1', 'p', 7, { a: 1 });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-request-id'), 'req-1');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { ok: true, schemaVersion: '0.1-draft', requestId: 'req-1', projectId: 'p', revision: 7, data: { a: 1 } });
});

test('handler wrapper turns an unexpected exception into a safe JSON 500', async (t) => {
  const log = t.mock.method(console, 'error', () => {});
  rateLimiter.reset();
  const POST = createPostHandler(async () => { throw new Error('stack rahasia'); });
  const response = await POST(jsonRequest({}));
  const text = await response.text();
  const body = JSON.parse(text);
  assert.equal(response.status, 500);
  assertErrorEnvelope(body, 'INTERNAL_ERROR');
  assert.doesNotMatch(text, /rahasia|stack/);
  assert.equal(response.headers.get('x-request-id'), body.requestId);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(log.mock.callCount(), 1);
  assert.ok(log.mock.calls[0].arguments[0].includes(body.requestId));
});

test('handler wrapper passes expected errors through without logging them', async (t) => {
  const log = t.mock.method(console, 'error', () => {});
  rateLimiter.reset();
  const POST = createPostHandler(async () => { throw new ApiError('STALE_REVISION', 'Revisi lama.'); });
  const response = await POST(jsonRequest({}));
  assert.equal(response.status, 409);
  const body = await response.json();
  assertErrorEnvelope(body, 'STALE_REVISION');
  assert.equal(body.error.message, 'Revisi lama.');
  assert.equal(log.mock.callCount(), 0);
});

test('invalid environment becomes a JSON 500, not an unhandled crash', async (t) => {
  t.mock.method(console, 'error', () => {});
  resetConfigForTests();
  process.env.NYURAT_MODE = 'salah';
  t.after(() => { delete process.env.NYURAT_MODE; resetConfigForTests(); });
  const response = await createPostHandler(async () => new Response('tidak terpanggil'))(jsonRequest({}));
  assert.equal(response.status, 500);
  assertErrorEnvelope(await response.json(), 'INTERNAL_ERROR');
});

test('method and not-found helpers answer with JSON envelopes', async () => {
  const notAllowed = await methodNotAllowed();
  assert.equal(notAllowed.status, 405);
  assert.equal(notAllowed.headers.get('allow'), 'POST');
  assertErrorEnvelope(await notAllowed.json(), 'METHOD_NOT_ALLOWED');
  const missing = await notFound();
  assert.equal(missing.status, 404);
  assertErrorEnvelope(await missing.json(), 'NOT_FOUND');
});

test('rate limiter blocks past the limit and recovers after the 60 second window', () => {
  let now = 0;
  const limiter = createRateLimiter(() => now);
  assert.equal(limiter.consume('a', 1, 2).allowed, true);
  assert.equal(limiter.consume('a', 1, 2).allowed, true);
  assert.deepEqual(limiter.consume('a', 1, 2), { allowed: false, retryAfterSeconds: 60 });
  assert.equal(limiter.consume('b', 1, 2).allowed, true, 'clients are counted separately');
  now = 59_000;
  assert.deepEqual(limiter.consume('a', 1, 2), { allowed: false, retryAfterSeconds: 1 });
  now = 60_000;
  assert.equal(limiter.consume('a', 1, 2).allowed, true);
});

test('rate limiter counts weight, so a photo audit uses three units', () => {
  const limiter = createRateLimiter(() => 0);
  assert.equal(limiter.consume('a', 3, 7).allowed, true);
  assert.equal(limiter.consume('a', 3, 7).allowed, true);
  assert.equal(limiter.consume('a', 3, 7).allowed, false);
  assert.equal(limiter.consume('a', 1, 7).allowed, true, 'a rejected audit spends nothing');
});

test('rate limiter stays bounded when keys are spoofed', () => {
  const limiter = createRateLimiter(() => 0);
  for (let index = 0; index < 10_050; index += 1) limiter.consume(`ip-${index}`, 1, 5);
  assert.ok(limiter.size <= 10_000);
});

test('wrapper answers RATE_LIMITED with Retry-After before running the handler', async (t) => {
  rateLimiter.reset();
  t.after(() => rateLimiter.reset());
  let calls = 0;
  const POST = createPostHandler(async () => { calls += 1; return new Response('ok'); }, { rateWeight: 30 });
  const headers = { 'x-forwarded-for': '203.0.113.9' };
  assert.equal((await POST(jsonRequest({}, headers))).status, 200);
  const blocked = await POST(jsonRequest({}, headers));
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers.get('retry-after')) > 0);
  assertErrorEnvelope(await blocked.json(), 'RATE_LIMITED');
  assert.equal(calls, 1);
});

test('client key uses the first forwarded address and falls back to local', () => {
  assert.equal(clientKey(new Headers({ 'x-forwarded-for': ' 203.0.113.9 , 10.0.0.1' })), '203.0.113.9');
  assert.equal(clientKey(new Headers()), 'local');
});

test('parse accepts the snapshot the frontend sends', async () => {
  const project = projectFor();
  const parsed = await parseProjectRequest(jsonRequest(payloadFor(project)));
  assert.equal(parsed.projectId, project.projectId);
  assert.equal(parsed.revision, project.revision);
  assert.deepEqual(parsed.project, project);
});

test('parse accepts a charset parameter on the content type', async () => {
  const project = projectFor();
  const request = jsonRequest(payloadFor(project), { 'content-type': 'Application/JSON; charset=utf-8' });
  assert.equal((await parseProjectRequest(request)).revision, project.revision);
});

test('parse rejects a wrong or missing content type', async () => {
  const project = projectFor();
  await rejectsWith(parseProjectRequest(jsonRequest(payloadFor(project), { 'content-type': 'text/plain' })), 'UNSUPPORTED_MEDIA_TYPE', 415);
  const bare = new Request('http://nyurat.test/x', { method: 'POST', body: new Uint8Array([123, 125]) });
  await rejectsWith(parseProjectRequest(bare), 'UNSUPPORTED_MEDIA_TYPE', 415);
});

test('parse rejects text that is not JSON, and invalid UTF-8', async () => {
  await rejectsWith(parseProjectRequest(jsonRequest('{bukan json')), 'INVALID_INPUT', 400);
  await rejectsWith(parseProjectRequest(jsonRequest('')), 'INVALID_INPUT', 400);
  const badBytes = new Request('http://nyurat.test/x', { method: 'POST', headers: { 'content-type': 'application/json' }, body: new Uint8Array([0x22, 0xff, 0x22]) });
  await rejectsWith(parseProjectRequest(badBytes), 'INVALID_INPUT', 400);
});

test('parse enforces 256 KB from Content-Length before reading anything', async () => {
  let pulled = false;
  const body = new ReadableStream({ pull(controller) { pulled = true; controller.close(); } }, { highWaterMark: 0 });
  const request = new Request('http://nyurat.test/x', { method: 'POST', duplex: 'half', headers: { 'content-type': 'application/json', 'content-length': String(MAX_JSON_BODY_BYTES + 1) }, body });
  await rejectsWith(parseProjectRequest(request), 'PAYLOAD_TOO_LARGE', 413);
  assert.equal(pulled, false);
});

test('parse enforces 256 KB on actual bytes when Content-Length understates', async () => {
  const oversized = JSON.stringify({ padding: 'x'.repeat(MAX_JSON_BODY_BYTES) });
  await rejectsWith(parseProjectRequest(jsonRequest(oversized, { 'content-length': '10' })), 'PAYLOAD_TOO_LARGE', 413);
  await rejectsWith(parseProjectRequest(jsonRequest(oversized)), 'PAYLOAD_TOO_LARGE', 413);
});

test('the byte limit counts bytes, not characters', async () => {
  const body = `"${'ᬅ'.repeat(90_000)}"`;
  assert.ok(body.length < MAX_JSON_BODY_BYTES);
  await rejectsWith(parseProjectRequest(jsonRequest(body)), 'PAYLOAD_TOO_LARGE', 413);
});

test('a body of exactly 256 KB is read, then judged on its content', async () => {
  const body = `"${'x'.repeat(MAX_JSON_BODY_BYTES - 2)}"`;
  await rejectsWith(parseProjectRequest(jsonRequest(body)), 'INVALID_INPUT', 400);
});

test('parse rejects the wrong schema version', async () => {
  const project = projectFor();
  await rejectsWith(parseProjectRequest(jsonRequest({ ...payloadFor(project), schemaVersion: '0.2' })), 'INVALID_INPUT', 400);
});

test('parse rejects an envelope that disagrees with its project', async () => {
  const project = projectFor();
  await rejectsWith(parseProjectRequest(jsonRequest({ ...payloadFor(project), revision: project.revision + 1 })), 'INVALID_INPUT', 400);
  await rejectsWith(parseProjectRequest(jsonRequest({ ...payloadFor(project), projectId: crypto.randomUUID() })), 'INVALID_INPUT', 400);
});

test('schema enforces the documented string and array limits', () => {
  const accepted = (change) => {
    const project = projectFor();
    change(project);
    return projectDraftSchema.safeParse(project).success;
  };
  assert.equal(accepted((p) => { p.input.latinName = 'a'.repeat(120); }), true);
  assert.equal(accepted((p) => { p.input.latinName = 'a'.repeat(121); }), false);
  assert.equal(accepted((p) => { p.checks.roundTrip.note = 'a'.repeat(2000); }), true);
  assert.equal(accepted((p) => { p.checks.roundTrip.note = 'a'.repeat(2001); }), false);
  assert.equal(accepted((p) => { p.checks.layout.findings = Array(51).fill('x'); }), false);
  assert.equal(accepted((p) => { p.projectId = 'bukan-uuid'; }), false);
  assert.equal(accepted((p) => { p.mode = 'lain'; }), false);
  assert.equal(accepted((p) => { p.languageReview.status = 'approved'; }), false);
});

test('schema limits pronunciation inside proposals and custom selections', () => {
  const provenance = { producer: 'rules', delivery: 'fresh', providerId: null, modelVersion: null, artifactVersion: 'v', sourceRefs: [] };
  const withOption = (pronunciation) => {
    const project = projectFor();
    project.proposal = { proposalId: 'p', inputRevision: 1, notationVersion: 'n', provenance, serviceState: 'unavailable', tokens: [{ tokenId: 't', original: 'x', languageGuess: null, options: [{ optionId: 'o', pronunciation, reason: 'r' }], suggestedOptionId: null, requiresConfirmation: true }] };
    return projectDraftSchema.safeParse(project).success;
  };
  assert.equal(withOption('a'.repeat(120)), true);
  assert.equal(withOption('a'.repeat(121)), false);
  const withCustom = (pronunciation) => {
    const project = projectFor();
    project.confirmation = { confirmationId: 'c', proposalId: 'p', inputRevision: 1, confirmedAt: 'now', selections: [{ tokenId: 't', kind: 'custom', pronunciation }] };
    return projectDraftSchema.safeParse(project).success;
  };
  assert.equal(withCustom('a'.repeat(120)), true);
  assert.equal(withCustom('a'.repeat(121)), false);
});

test('a cleared layout field survives JSON and reaches validateLayout as NaN', async () => {
  const project = projectFor();
  project.layout = { ...project.layout, marginMm: Number.NaN };
  const parsed = await parseProjectRequest(jsonRequest(JSON.stringify(payloadFor(project))));
  assert.ok(Number.isNaN(parsed.project.layout.marginMm));
  assert.equal(validateLayout(parsed.project.layout), 'Isi semua ukuran dengan angka yang valid.');
});

test('unknown keys are dropped rather than passed along', async () => {
  const project = projectFor();
  const body = JSON.stringify(payloadFor(project)).replace('"mode":', '"__proto__":{"polluted":true},"mode":');
  const parsed = await parseProjectRequest(jsonRequest(body));
  assert.equal(Object.hasOwn(parsed.project, '__proto__'), false);
  assert.equal({}.polluted, undefined);
});

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

test('every server module is marked server-only', () => {
  for (const file of sourceFiles('src/server')) assert.match(readFileSync(file, 'utf8'), /^import "server-only";/, file);
});

test('client-side code never imports from src/server', () => {
  for (const file of [...sourceFiles('src/components'), ...sourceFiles('src/lib'), 'src/app/page.tsx', 'src/app/layout.tsx']) {
    assert.doesNotMatch(readFileSync(file, 'utf8'), /from\s+["'][^"']*server\//, file);
  }
});
