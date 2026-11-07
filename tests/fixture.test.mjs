import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createApiService } from '../src/lib/api-service.ts';
import { photoAnalysisSchema, requestPhotoAudit } from '../src/lib/photo-audit.ts';
import { confirmProject, createInitialProject, invalidateInput, isLayoutSample, updateLayout, validateSnapshot } from '../src/lib/project.ts';
import * as boardRenders from '../src/app/api/v1/board-renders/route.ts';
import * as exportsRoute from '../src/app/api/v1/exports/route.ts';
import * as catchAll from '../src/app/api/v1/[[...path]]/route.ts';
import * as photoAudits from '../src/app/api/v1/photo-audits/route.ts';
import * as proposals from '../src/app/api/v1/pronunciation-proposals/route.ts';
import * as reviewPackages from '../src/app/api/v1/review-packages/route.ts';
import { parseConfig, resetConfigForTests } from '../src/server/config.ts';
import { setGeminiSdkForTests } from '../src/server/gemini/client.ts';
import { rateLimiter } from '../src/server/http/rate-limit.ts';

const ROUTES = { 'pronunciation-proposals': proposals, 'board-renders': boardRenders, 'review-packages': reviewPackages, exports: exportsRoute, 'photo-audits': photoAudits };
const SAMPLE_PATH = 'tests/fixtures/papan-warung-sari-contoh.png';
const sample = () => readFileSync(SAMPLE_PATH);
const failingSdk = { models: { generateContent: async () => { throw new Error('Mode fixture tidak boleh memanggil Gemini.'); } } };
const originalNodeEnv = process.env.NODE_ENV;

beforeEach(() => {
  process.env.NYURAT_MODE = 'fixture';
  delete process.env.GEMINI_API_KEY;
  resetConfigForTests();
  setGeminiSdkForTests(failingSdk);
  rateLimiter.reset();
});

afterEach(() => {
  delete process.env.NYURAT_MODE;
  delete process.env.GEMINI_API_KEY;
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
  resetConfigForTests();
});

function projectFor(name = 'Warung Sari') {
  return invalidateInput(createInitialProject(), { latinName: name, businessType: 'warung', sourceLanguage: 'id' });
}

function firstOptions(project) {
  return project.proposal.tokens.map((token) => ({ tokenId: token.tokenId, kind: 'option', optionId: token.options[0].optionId }));
}

function routeFetch(t) {
  t.mock.method(globalThis, 'fetch', async (url, options) => ROUTES[url.split('/').pop()].POST(new Request(new URL(url, 'http://nyurat.test'), options)));
}

async function flow(service = createApiService(), name) {
  let project = projectFor(name);
  project = { ...project, proposal: await service.suggestPronunciation(project) };
  project = confirmProject(project, firstOptions(project));
  project = { ...project, ...await service.renderBoard(project) };
  assert.equal(validateSnapshot(project), null);
  return project;
}

function postPhoto(bytes, revision = '1') {
  const form = new FormData();
  form.append('photo', new File([bytes], 'papan.png', { type: 'image/png' }));
  form.append('photoRevision', revision);
  return photoAudits.POST(new Request('http://nyurat.test/api/v1/photo-audits', { method: 'POST', body: form }));
}

test('live is the default mode', () => {
  assert.equal(parseConfig({}).mode, 'live');
});

test('fixture results say they are sample data, end to end', async (t) => {
  routeFetch(t);
  const project = await flow();
  assert.equal(project.proposal.provenance.producer, 'fixture');
  assert.equal(project.proposal.serviceState, 'not_called');
  assert.equal(project.transliteration.provenance.producer, 'fixture');
  assert.equal(project.transliteration.kind, 'layout_sample');
  assert.equal(isLayoutSample(project), true);
  assert.equal(project.checks.roundTrip.status, 'unavailable');
});

test('fixture exports work and keep the sample status', async (t) => {
  routeFetch(t);
  const service = createApiService();
  const project = await flow(service);
  const svg = await service.exportBoard(project);
  assert.equal(svg.filename, 'nyurat-papan-contoh.svg');
  assert.equal(svg.contents.match(/data:font\/woff2;base64,/g).length, 2);
  const review = await service.createReviewPackage(project);
  assert.equal(review.filename, 'nyurat-paket-pemeriksaan-contoh.json');
  assert.equal(JSON.parse(review.contents).status, 'data_contoh_belum_diperiksa_ahli');
});

test('fixture mode runs in a production build', async (t) => {
  process.env.NODE_ENV = 'production';
  routeFetch(t);
  assert.equal((await flow()).proposal.provenance.producer, 'fixture');
});

test('fixture mode never calls Gemini, even with a key', async (t) => {
  process.env.GEMINI_API_KEY = 'kunci-uji';
  resetConfigForTests();
  let called = false;
  setGeminiSdkForTests({ models: { generateContent: async () => { called = true; return {}; } } });
  routeFetch(t);
  await flow();
  assert.equal((await postPhoto(sample())).status, 200);
  assert.equal(called, false);
});

test('fixture mode keeps the same envelope and validation', async () => {
  const project = projectFor();
  const payload = { schemaVersion: '0.1-draft', projectId: project.projectId, revision: project.revision, project };
  const request = (body) => new Request('http://nyurat.test/x', { method: 'POST', headers: { 'content-type': 'application/json' }, body });
  const success = await proposals.POST(request(JSON.stringify(payload)));
  const body = await success.json();
  assert.equal(success.status, 200);
  assert.deepEqual([body.ok, body.schemaVersion, body.projectId, body.revision], [true, '0.1-draft', project.projectId, project.revision]);
  assert.equal(success.headers.get('x-request-id'), body.requestId);
  assert.equal((await proposals.POST(request('{bukan json'))).status, 400);
  assert.equal((await proposals.POST(request(JSON.stringify({ ...payload, revision: 99 })))).status, 400);
});

test('fixture errors keep their code and message', async () => {
  const project = projectFor('');
  const response = await proposals.POST(new Request('http://nyurat.test/x', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ schemaVersion: '0.1-draft', projectId: project.projectId, revision: project.revision, project }) }));
  const body = await response.json();
  assert.equal(response.status, 400);
  assert.deepEqual([body.error.code, body.error.message], ['INVALID_INPUT', 'Isi nama usaha terlebih dahulu.']);
});

test('a stale fixture snapshot is refused on both exports', async (t) => {
  routeFetch(t);
  const service = createApiService();
  const moved = updateLayout(await flow(service), { ...projectFor().layout, marginMm: 50 });
  await assert.rejects(service.exportBoard(moved), { code: 'STALE_REVISION' });
  await assert.rejects(service.createReviewPackage(moved), { code: 'STALE_REVISION' });
});

test('the sample photo gets the sample audit', async () => {
  const response = await postPhoto(sample(), '5');
  const body = await response.json();
  assert.equal(response.status, 200);
  const data = photoAnalysisSchema.parse(body.data);
  assert.equal(data.provenance.producer, 'fixture');
  assert.equal(data.photoRevision, 5);
  assert.deepEqual(data.image, { width: 1200, height: 600 });
  assert.equal(data.status, 'detected');
});

test('the frontend client accepts the sample audit', async (t) => {
  routeFetch(t);
  const result = await requestPhotoAudit(new File([sample()], 'papan.png', { type: 'image/png' }), 2, new AbortController().signal);
  assert.equal(result.photoRevision, 2);
});

test('any other photo is refused in JSON rather than given a fake result', async () => {
  const response = await postPhoto(Buffer.concat([sample(), Buffer.from([0])]));
  const body = await response.json();
  assert.equal(response.status, 400);
  assert.equal(body.ok, false);
  assert.equal(body.error.code, 'INVALID_INPUT');
  assert.equal(Object.hasOwn(body, 'data'), false);
});

test('upload validation still runs before the sample check', async () => {
  assert.equal((await postPhoto(sample(), 'abc')).status, 400);
  const json = await photoAudits.POST(new Request('http://nyurat.test/x', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }));
  assert.equal(json.status, 415);
});

test('the sample digest matches the shipped file', () => {
  const source = readFileSync('src/server/fixture.ts', 'utf8');
  assert.ok(source.includes(createHash('sha256').update(sample()).digest('hex')));
});

test('live mode ignores the fixture path', async () => {
  delete process.env.NYURAT_MODE;
  resetConfigForTests();
  const response = await postPhoto(sample());
  assert.equal(response.status, 503);
});

for (const method of ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
  test(`unknown addresses answer ${method} with a JSON 404`, async () => {
    const response = await catchAll[method](new Request('http://nyurat.test/api/v1/tidak-ada', { method }));
    assert.equal(response.status, 404);
    const body = await response.json();
    assert.equal(body.ok, false);
    assert.equal(body.schemaVersion, '0.1-draft');
    assert.equal(body.error.code, 'NOT_FOUND');
    assert.equal(response.headers.get('x-request-id'), body.requestId);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  });
}

test('the old adapter is gone', () => {
  assert.equal(existsSync('src/app/api/v1/[operation]/route.ts'), false);
  for (const file of Object.keys(ROUTES)) assert.doesNotMatch(readFileSync(`src/app/api/v1/${file}/route.ts`, 'utf8'), /NODE_ENV/, file);
});

test('.env.example documents every variable and parses as written', () => {
  const lines = readFileSync('.env.example', 'utf8').split('\n');
  const entries = Object.fromEntries(lines.filter((line) => /^[A-Z_]+=/.test(line)).map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]));
  assert.deepEqual(Object.keys(entries).sort(), ['GEMINI_API_KEY', 'GEMINI_MODEL', 'NYURAT_MODE', 'NYURAT_RATE_LIMIT_PER_MIN']);
  assert.equal(entries.GEMINI_API_KEY, '', 'the example must never hold a real key');
  assert.deepEqual(parseConfig(entries), { geminiApiKey: null, geminiModel: 'gemini-3.6-flash', rateLimitPerMinute: 30, mode: 'live' });
  assert.ok(lines.some((line) => line.includes('PORT=')));
  assert.equal(lines.some((line) => line.startsWith('NEXT_PUBLIC_')), false);
});

test('start:prod binds every interface and leaves the local script alone', () => {
  const { scripts } = JSON.parse(readFileSync('package.json', 'utf8'));
  assert.equal(scripts.start, 'next start --hostname 127.0.0.1');
  assert.match(scripts['start:prod'], /^next start --hostname 0\.0\.0\.0/);
  assert.doesNotMatch(scripts['start:prod'], /\$\{/, 'cmd.exe does not expand this; next start reads PORT itself');
});
