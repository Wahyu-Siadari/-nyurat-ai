import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createApiService } from '../src/lib/api-service.ts';
import { projectDraftSchema } from '../src/lib/contract.ts';
import { confirmProject, createInitialProject, DEFAULT_LAYOUT, invalidateInput, updateLayout, validateSnapshot } from '../src/lib/project.ts';
import * as boardRenders from '../src/app/api/v1/board-renders/route.ts';
import * as exportsRoute from '../src/app/api/v1/exports/route.ts';
import * as proposals from '../src/app/api/v1/pronunciation-proposals/route.ts';
import * as reviewPackages from '../src/app/api/v1/review-packages/route.ts';
import { ENGINE_VERSION, RULES_VERSION, SOURCE_REFS } from '../src/server/aksara/version.ts';
import { slugify } from '../src/server/board/export.ts';
import { resetConfigForTests } from '../src/server/config.ts';
import { setGeminiSdkForTests } from '../src/server/gemini/client.ts';
import { MAX_JSON_BODY_BYTES } from '../src/server/http/parse-project.ts';
import { rateLimiter } from '../src/server/http/rate-limit.ts';
import { clearProposalCacheForTests } from '../src/server/pronunciation/gemini-proposer.ts';

const ROUTES = { 'pronunciation-proposals': proposals, 'board-renders': boardRenders, 'review-packages': reviewPackages, exports: exportsRoute };
const FROZEN_TIME = '2026-11-06T00:00:00.000Z';
const forbiddenSdk = { models: { generateContent: async () => { throw new Error('Tes tidak boleh memanggil Gemini sungguhan.'); } } };

beforeEach(() => {
  delete process.env.GEMINI_API_KEY;
  resetConfigForTests();
  clearProposalCacheForTests();
  setGeminiSdkForTests(forbiddenSdk);
  rateLimiter.reset();
});

function payloadFor(project) {
  return { schemaVersion: '0.1-draft', projectId: project.projectId, revision: project.revision, project };
}

function jsonRequest(body, headers = {}) {
  return new Request('http://nyurat.test/api/v1/x', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
}

async function call(name, project) {
  const response = await ROUTES[name].POST(jsonRequest(payloadFor(project)));
  return { response, body: await response.json() };
}

function projectFor(name = 'Warung Sari') {
  return invalidateInput(createInitialProject(), { latinName: name, businessType: 'warung', sourceLanguage: 'id' });
}

async function proposed(name) {
  const project = projectFor(name);
  const { body } = await call('pronunciation-proposals', project);
  assert.equal(body.ok, true);
  return { ...project, proposal: body.data };
}

function firstOptions(project) {
  return project.proposal.tokens.map((token) => ({ tokenId: token.tokenId, kind: 'option', optionId: token.options[0].optionId }));
}

async function confirmed(name, selections = firstOptions) {
  const project = await proposed(name);
  return confirmProject(project, selections(project), FROZEN_TIME);
}

async function rendered(name, selections) {
  const project = await confirmed(name, selections);
  const { body } = await call('board-renders', project);
  assert.equal(body.ok, true, JSON.stringify(body.error));
  return { ...project, ...body.data };
}

function measured(project) {
  return { ...project, checks: { ...project.checks, layout: { status: 'pass', findings: ['Pemeriksaan terbatas pada batas teks di pratinjau peramban; belum validasi cetak atau kepatuhan.'] } } };
}

function assertFailure({ response, body }, status, code) {
  assert.equal(response.status, status, JSON.stringify(body));
  assert.equal(body.ok, false);
  assert.equal(body.schemaVersion, '0.1-draft');
  assert.equal(body.error.code, code);
  assert.equal(typeof body.error.message, 'string');
  assert.equal(typeof body.error.retryable, 'boolean');
  assert.equal(response.headers.get('x-request-id'), body.requestId);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('content-type'), 'application/json');
}

async function readFailure(response) {
  return { response, body: await response.json() };
}

async function snapshotFor(name) {
  if (name === 'pronunciation-proposals') return projectFor();
  if (name === 'board-renders') return confirmed();
  return measured(await rendered());
}

for (const [name, route] of Object.entries(ROUTES)) {
  test(`${name}: declares its runtime and segment config`, () => {
    assert.equal(route.runtime, 'nodejs');
    assert.equal(route.dynamic, 'force-dynamic');
    assert.ok(route.maxDuration >= 10 && route.maxDuration <= 60);
  });

  test(`${name}: success keeps the request identity`, async () => {
    const project = await snapshotFor(name);
    const { response, body } = await call(name, project);
    assert.equal(response.status, 200, JSON.stringify(body));
    assert.equal(body.ok, true);
    assert.equal(body.schemaVersion, '0.1-draft');
    assert.equal(body.projectId, project.projectId);
    assert.equal(body.revision, project.revision);
    assert.equal(response.headers.get('x-request-id'), body.requestId);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  });

  test(`${name}: a body that is not JSON`, async () => {
    assertFailure(await readFailure(await route.POST(jsonRequest('{bukan json'))), 400, 'INVALID_INPUT');
  });

  test(`${name}: a wrong content type`, async () => {
    const project = await snapshotFor(name);
    assertFailure(await readFailure(await route.POST(jsonRequest(payloadFor(project), { 'content-type': 'text/plain' }))), 415, 'UNSUPPORTED_MEDIA_TYPE');
  });

  test(`${name}: a body over the limit`, async () => {
    assertFailure(await readFailure(await route.POST(jsonRequest('x'.repeat(MAX_JSON_BODY_BYTES + 1)))), 413, 'PAYLOAD_TOO_LARGE');
  });

  test(`${name}: a revision that disagrees with the project`, async () => {
    const project = await snapshotFor(name);
    assertFailure(await readFailure(await route.POST(jsonRequest({ ...payloadFor(project), revision: project.revision + 1 }))), 400, 'INVALID_INPUT');
  });

  test(`${name}: a project that fails the schema`, async () => {
    const project = await snapshotFor(name);
    assertFailure(await readFailure(await route.POST(jsonRequest({ ...payloadFor(project), project: { ...project, mode: 'lain' } }))), 400, 'INVALID_INPUT');
  });

  for (const method of ['GET', 'HEAD', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
    test(`${name}: ${method} is refused`, async () => {
      assert.equal(typeof route[method], 'function');
      const response = await route[method](new Request('http://nyurat.test/api/v1/x', { method }));
      assert.equal(response.status, 405);
      assert.equal(response.headers.get('allow'), 'POST');
      assertFailure({ response, body: await response.json() }, 405, 'METHOD_NOT_ALLOWED');
    });
  }

  test(`${name}: an unexpected exception stays a safe JSON envelope`, async (t) => {
    const project = await snapshotFor(name);
    const log = t.mock.method(console, 'error', () => {});
    const broken = t.mock.method(String.prototype, 'normalize', () => { throw new Error('gagal di C:/rahasia/server.ts'); });
    const response = await route.POST(jsonRequest(payloadFor(project)));
    broken.mock.restore();
    const text = await response.text();
    assertFailure({ response, body: JSON.parse(text) }, 500, name === 'exports' || name === 'review-packages' ? 'EXPORT_FAILED' : 'INTERNAL_ERROR');
    assert.equal(JSON.parse(text).error.retryable, true);
    assert.doesNotMatch(text, /rahasia|server\.ts/);
    assert.ok(log.mock.callCount() >= 1);
  });

  test(`${name}: the rate limit answers in JSON`, async () => {
    const project = await snapshotFor(name);
    rateLimiter.reset();
    for (let index = 0; index < 30; index += 1) rateLimiter.consume('203.0.113.7', 1, 30);
    const blocked = await route.POST(jsonRequest(payloadFor(project), { 'x-forwarded-for': '203.0.113.7' }));
    assertFailure(await readFailure(blocked), 429, 'RATE_LIMITED');
    assert.ok(Number(blocked.headers.get('retry-after')) > 0);
  });
}

test('proposals: without a key the rules still answer with 200', async () => {
  const { response, body } = await call('pronunciation-proposals', projectFor('Sate Lilit 108'));
  assert.equal(response.status, 200);
  assert.equal(body.data.serviceState, 'unavailable');
  assert.deepEqual(body.data.provenance.sourceRefs, [...SOURCE_REFS]);
  assert.deepEqual(body.data.tokens.map((token) => token.original), ['Sate', 'Lilit', '108']);
  assert.ok(body.data.tokens.every((token) => token.requiresConfirmation && token.suggestedOptionId === null));
});

test('proposals: quota and timeout are reported in a 200 with rule options', async (t) => {
  t.mock.method(console, 'error', () => {});
  process.env.GEMINI_API_KEY = 'kunci-uji';
  resetConfigForTests();
  for (const [error, state] of [[Object.assign(new Error('x'), { status: 429 }), 'quota_exhausted'], [Object.assign(new Error('x'), { name: 'AbortError' }), 'timeout']]) {
    setGeminiSdkForTests({ models: { generateContent: async () => { throw error; } } });
    const { response, body } = await call('pronunciation-proposals', projectFor('Sari'));
    assert.equal(response.status, 200);
    assert.equal(body.data.serviceState, state);
    assert.equal(body.data.tokens[0].options[0].pronunciation, 'sari');
  }
});

test('proposals: invalid names return the message from validateInput', async () => {
  const empty = await call('pronunciation-proposals', projectFor(''));
  assertFailure(empty, 400, 'INVALID_INPUT');
  assert.equal(empty.body.error.message, 'Isi nama usaha terlebih dahulu.');
  const script = await call('pronunciation-proposals', projectFor('バリ'));
  assertFailure(script, 400, 'INVALID_INPUT');
  assert.equal(script.body.error.message, 'Gunakan nama berhuruf Latin.');
});

test('proposals: the proposal id is stable per input and changes with it', async () => {
  const project = projectFor('Sari');
  const first = (await call('pronunciation-proposals', project)).body.data.proposalId;
  const second = (await call('pronunciation-proposals', project)).body.data.proposalId;
  const other = (await call('pronunciation-proposals', projectFor('Sara'))).body.data.proposalId;
  assert.equal(first, second);
  assert.notEqual(first, other);
});

test('proposals: asking again from a finished draft is accepted', async () => {
  const project = await rendered();
  const { response, body } = await call('pronunciation-proposals', project);
  assert.equal(response.status, 200);
  assert.equal(body.data.proposalId, project.proposal.proposalId);
});

test('proposals: an unfinished layout does not block the request', async () => {
  const project = projectFor('Sari');
  project.layout = { ...DEFAULT_LAYOUT, marginMm: Number.NaN };
  const { response } = await call('pronunciation-proposals', project);
  assert.equal(response.status, 200);
});

test('renders: the result passes the frontend snapshot check and fits the draft schema', async () => {
  const project = await confirmed();
  const { body } = await call('board-renders', project);
  const next = { ...project, ...body.data };
  assert.equal(validateSnapshot(next), null);
  assert.equal(projectDraftSchema.safeParse(next).success, true);
  assert.deepEqual(body.data.render, { renderId: `render-${project.revision}-${project.layout.layoutRevision}`, basedOnRevision: project.revision, inputRevision: project.input.inputRevision, resultId: body.data.transliteration.resultId, layoutRevision: project.layout.layoutRevision });
});

test('renders: transliterates the chosen pronunciation with full provenance', async () => {
  const project = await confirmed();
  const { transliteration, checks } = (await call('board-renders', project)).body.data;
  assert.equal(transliteration.balineseUnicode, '\u1B2F\u1B2D\u1B38\u1B02 \u1B32\u1B2D\u1B36');
  assert.equal(transliteration.confirmationId, project.confirmation.confirmationId);
  assert.equal(transliteration.kind, 'transliteration');
  assert.equal(transliteration.matchesInput, true);
  assert.equal(transliteration.engineVersion, ENGINE_VERSION);
  assert.equal(transliteration.rulesVersion, RULES_VERSION);
  assert.deepEqual(transliteration.sourceRefs, [...SOURCE_REFS]);
  assert.deepEqual(transliteration.unsupportedTokenIds, []);
  assert.deepEqual(transliteration.provenance, { producer: 'rules', delivery: 'fresh', providerId: null, modelVersion: null, artifactVersion: ENGINE_VERSION, sourceRefs: [...SOURCE_REFS] });
  assert.match(transliteration.resultId, new RegExp(`^translit-${project.revision}-[0-9a-f]{12}$`));
  assert.deepEqual(checks, { roundTrip: { status: 'pass', note: 'Hasil balik sama dengan pelafalan pilihan (pemeriksaan teknis, bukan pemeriksaan bahasa).', originalLatin: 'warung sari', returnedLatin: 'warung sari' }, layout: { status: 'not_run', findings: [] } });
});

test('renders: uses the pronunciation, not the Latin name', async () => {
  const custom = () => [{ tokenId: 'token-1', kind: 'custom', pronunciation: ' SĀRI ' }, { tokenId: 'token-2', kind: 'option', optionId: 'rules-1' }];
  const project = await rendered('Sari Bali', custom);
  assert.equal(project.transliteration.balineseUnicode, '\u1B32\u1B35\u1B2D\u1B36 \u1B29\u1B2E\u1B36');
  assert.equal(project.checks.roundTrip.originalLatin, 'sāri bali');
});

test('renders: the same snapshot gives the same output and result id', async () => {
  const project = await confirmed();
  const first = (await call('board-renders', project)).body.data;
  const second = (await call('board-renders', project)).body.data;
  assert.deepEqual(second, first);
});

test('renders: client transliteration and render are ignored on the second call', async () => {
  const project = await rendered();
  const changed = updateLayout(project, { ...project.layout, marginMm: 50 });
  const forged = { ...changed, transliteration: { ...changed.transliteration, balineseUnicode: '\u1B05', matchesInput: false }, render: { ...project.render } };
  const { body } = await call('board-renders', forged);
  assert.equal(body.data.transliteration.balineseUnicode, project.transliteration.balineseUnicode);
  assert.equal(body.data.transliteration.matchesInput, true);
  assert.equal(body.data.render.layoutRevision, changed.layout.layoutRevision);
  assert.equal(validateSnapshot({ ...forged, ...body.data }), null);
});

test('renders: unsupported tokens are listed, and the rest is still written', async () => {
  const project = await rendered('Warung & Café');
  assert.deepEqual(project.transliteration.unsupportedTokenIds, ['token-2', 'token-3']);
  assert.equal(project.transliteration.matchesInput, false);
  assert.equal(project.transliteration.balineseUnicode, '\u1B2F\u1B2D\u1B38\u1B02 \u1B18\u1B27\u1B34\u1B3E');
  assert.equal(project.checks.roundTrip.status, 'mismatch');
});

test('renders: a name with nothing to write is refused, and a custom reading rescues it', async () => {
  const project = await confirmed('&');
  const refused = await call('board-renders', project);
  assertFailure(refused, 400, 'INVALID_INPUT');
  assert.match(refused.body.error.message, /Tulis pelafalannya sendiri/);
  const fixed = await rendered('&', () => [{ tokenId: 'token-1', kind: 'custom', pronunciation: 'dan' }]);
  assert.equal(fixed.transliteration.matchesInput, true);
  assert.equal(fixed.transliteration.balineseUnicode, '\u1B24\u1B26\u1B44');
});

test('renders: a lossy letter is reported as a mismatch with both readings', async () => {
  const project = await rendered('Xena');
  assert.equal(project.checks.roundTrip.status, 'mismatch');
  assert.equal(project.checks.roundTrip.originalLatin, 'xena');
  assert.equal(project.checks.roundTrip.returnedLatin, 'ksena');
  assert.equal(project.transliteration.matchesInput, true);
});

test('renders: refuses a draft without confirmation', async () => {
  const response = await call('board-renders', await proposed());
  assertFailure(response, 400, 'INVALID_INPUT');
  assert.equal(response.body.error.message, 'Konfirmasi pelafalan terlebih dahulu.');
});

test('renders: refuses incomplete selections and invalid layouts with their own messages', async () => {
  const project = await confirmed();
  const partial = await call('board-renders', { ...project, confirmation: { ...project.confirmation, selections: project.confirmation.selections.slice(0, 1) } });
  assertFailure(partial, 400, 'INVALID_INPUT');
  assert.equal(partial.body.error.message, 'Pilih pelafalan untuk setiap token.');
  const tiny = await call('board-renders', { ...project, layout: { ...project.layout, boardMm: { width: 10, height: 10 } } });
  assertFailure(tiny, 400, 'INVALID_INPUT');
  assert.equal(tiny.body.error.message, 'Lebar dan tinggi harus 100 sampai 10000 mm.');
  const cleared = await call('board-renders', { ...project, layout: { ...project.layout, marginMm: Number.NaN } });
  assertFailure(cleared, 400, 'INVALID_INPUT');
  assert.equal(cleared.body.error.message, 'Isi semua ukuran dengan angka yang valid.');
});

test('renders: a confirmation from an older proposal or input is stale', async () => {
  const project = await confirmed();
  assertFailure(await call('board-renders', { ...project, confirmation: { ...project.confirmation, proposalId: 'proposal-lama' } }), 409, 'STALE_REVISION');
  assertFailure(await call('board-renders', { ...project, confirmation: { ...project.confirmation, inputRevision: project.input.inputRevision + 1 } }), 409, 'STALE_REVISION');
  assertFailure(await call('board-renders', { ...project, proposal: { ...project.proposal, inputRevision: project.input.inputRevision + 1 } }), 409, 'STALE_REVISION');
});

test('renders: the longest name stays acceptable on the next request', async () => {
  const name = Array.from({ length: 60 }, () => 'a').join(' ');
  const custom = (project) => project.proposal.tokens.map((token) => ({ tokenId: token.tokenId, kind: 'custom', pronunciation: 'ka'.repeat(60) }));
  const project = await rendered(name, custom);
  assert.equal(projectDraftSchema.safeParse(project).success, true);
  assert.equal((await call('exports', measured(project))).response.status, 200);
});

test('exports: delivers an SVG with both fonts embedded', async () => {
  const project = measured(await rendered());
  const { filename, mimeType, contents } = (await call('exports', project)).body.data;
  assert.equal(filename, `nyurat-papan-warung-sari-r${project.revision}.svg`);
  assert.equal(mimeType, 'image/svg+xml');
  assert.ok(contents.startsWith('<?xml'));
  assert.equal(contents.match(/data:font\/woff2;base64,/g).length, 2);
  assert.ok(contents.includes('\u1B2F\u1B2D\u1B38\u1B02 \u1B32\u1B2D\u1B36'));
  assert.match(contents, /width="1200mm"/);
});

test('exports: user text is escaped by buildSvg', async () => {
  const project = measured(await rendered('Warung & Sari'));
  const { contents } = (await call('exports', project)).body.data;
  assert.ok(contents.includes('Warung &amp; Sari'));
  assert.ok(!contents.includes('Warung & Sari'));
});

test('exports and packages: a snapshot from an older revision is stale', async () => {
  const project = measured(await rendered());
  const moved = updateLayout(project, { ...project.layout, marginMm: 50 });
  for (const name of ['exports', 'review-packages']) {
    assertFailure(await call(name, moved), 409, 'STALE_REVISION');
    const older = await call(name, { ...project, render: { ...project.render, basedOnRevision: project.revision - 1 } });
    assertFailure(older, 409, 'STALE_REVISION');
    assert.equal(older.body.error.message, 'Pratinjau mengacu pada revisi sebelumnya. Perbarui pratinjau terlebih dahulu.');
  }
});

test('exports and packages: forged aksara or result ids are refused', async () => {
  const project = measured(await rendered());
  const forgedText = { ...project, transliteration: { ...project.transliteration, balineseUnicode: '\u1B05' } };
  const forgedId = { ...project, transliteration: { ...project.transliteration, resultId: 'translit-palsu' }, render: { ...project.render, resultId: 'translit-palsu' } };
  for (const name of ['exports', 'review-packages']) {
    for (const forged of [forgedText, forgedId]) {
      assert.equal(validateSnapshot(forged), null, 'the forgery must get past the shared snapshot check');
      const refused = await call(name, forged);
      assertFailure(refused, 409, 'STALE_REVISION');
      assert.equal(refused.body.error.message, 'Pratinjau mengacu pada hasil lama. Perbarui pratinjau terlebih dahulu.');
    }
  }
});

test('exports and packages: claims the engine can derive are replaced by what it derives', async () => {
  const project = measured(await rendered('Warung & Sari'));
  const flattering = { ...project, transliteration: { ...project.transliteration, matchesInput: true, unsupportedTokenIds: [], engineVersion: 'palsu', provenance: { ...project.transliteration.provenance, producer: 'fixture' } }, checks: { ...project.checks, roundTrip: { status: 'pass', note: 'palsu' } } };
  const packaged = JSON.parse((await call('review-packages', flattering)).body.data.contents);
  assert.equal(packaged.project.transliteration.matchesInput, false);
  assert.deepEqual(packaged.project.transliteration.unsupportedTokenIds, ['token-2']);
  assert.equal(packaged.project.transliteration.engineVersion, ENGINE_VERSION);
  assert.equal(packaged.status, 'draf_belum_diperiksa_ahli');
  assert.equal(packaged.project.checks.roundTrip.status, 'mismatch');
  const { contents } = (await call('exports', flattering)).body.data;
  assert.match(contents, /contoh tata letak/);
});

test('review package: carries the snapshot, browser measurement, and a backend block', async () => {
  const project = measured(await rendered());
  const { body } = await call('review-packages', project);
  const { filename, mimeType, contents } = body.data;
  assert.equal(filename, `nyurat-paket-pemeriksaan-warung-sari-r${project.revision}.json`);
  assert.equal(mimeType, 'application/json');
  const packaged = JSON.parse(contents);
  assert.equal(packaged.documentType, 'lembar_pemeriksaan_papan_nama');
  assert.equal(packaged.printReadiness, 'not_tested');
  assert.deepEqual(packaged.project.checks.layout, project.checks.layout);
  assert.equal(packaged.project.languageReview.status, 'unreviewed');
  const { generatedAt, ...backend } = packaged.backend;
  assert.deepEqual(backend, { engineVersion: ENGINE_VERSION, rulesVersion: RULES_VERSION, notationVersion: 'nyurat-notation-0.1', requestId: body.requestId });
  assert.ok(!Number.isNaN(Date.parse(generatedAt)));
  assert.ok(contents.includes('\n  "documentType"'));
});

test('slug is ASCII, lower case, bounded, and never empty', () => {
  assert.equal(slugify('Warung Sari'), 'warung-sari');
  assert.equal(slugify('  Café & Éclair!! '), 'cafe-eclair');
  assert.equal(slugify('&'), 'draf');
  assert.equal(slugify('...'), 'draf');
  const long = slugify('a'.repeat(39) + ' bcd');
  assert.equal(long, 'a'.repeat(39));
  assert.match(slugify('Ünï çödé ßtraße Ⅷ'), /^[a-z0-9-]+$/);
  assert.ok(slugify('kata '.repeat(30)).length <= 40);
});

function routeFetch(t) {
  const paths = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    paths.push(url);
    const route = ROUTES[url.split('/').pop()];
    return route.POST(new Request(`http://nyurat.test${url}`, options));
  });
  return paths;
}

async function walkFrontendFlow(service, name) {
  let project = projectFor(name);
  project = { ...project, proposal: await service.suggestPronunciation(project) };
  project = confirmProject(project, firstOptions(project));
  project = { ...project, ...await service.renderBoard(project) };
  assert.equal(validateSnapshot(project), null);
  project = updateLayout(project, { ...project.layout, marginMm: 45 });
  project = { ...project, ...await service.renderBoard(project) };
  assert.equal(validateSnapshot(project), null);
  const snapshot = measured(project);
  return { project, svg: await service.exportBoard(snapshot), review: await service.createReviewPackage(snapshot) };
}

test('contract: the real frontend adapter accepts every route, rules only', async (t) => {
  const paths = routeFetch(t);
  const { svg, review, project } = await walkFrontendFlow(createApiService(), 'Warung Sari');
  assert.deepEqual(paths, ['/api/v1/pronunciation-proposals', '/api/v1/board-renders', '/api/v1/board-renders', '/api/v1/exports', '/api/v1/review-packages']);
  assert.equal(project.proposal.serviceState, 'unavailable');
  assert.match(svg.filename, /\.svg$/);
  assert.match(review.filename, /\.json$/);
});

test('contract: the real frontend adapter accepts every route with AI options', async (t) => {
  t.mock.method(console, 'error', () => {});
  process.env.GEMINI_API_KEY = 'kunci-uji';
  resetConfigForTests();
  setGeminiSdkForTests({ models: { generateContent: async () => ({ text: JSON.stringify({ tokens: [{ tokenId: 'token-1', languageGuess: 'id', options: [{ pronunciation: 'warung', reason: 'Kata umum.' }] }, { tokenId: 'token-2', languageGuess: 'ban', options: [{ pronunciation: 'sāri', reason: 'Vokal panjang.' }] }] }) }) } });
  routeFetch(t);
  const { project } = await walkFrontendFlow(createApiService(), 'Warung Sari');
  assert.equal(project.proposal.provenance.producer, 'ai');
  assert.equal(project.proposal.serviceState, 'available');
  assert.equal(project.proposal.tokens[1].suggestedOptionId, 'ai-1');
});

test('contract: names with symbols and foreign letters complete the same flow', async (t) => {
  routeFetch(t);
  for (const name of ['Café Sari 108', 'Warung & Sari', "D'Bali Vila", 'Müller Gede', 'Toko Xena']) {
    const { svg } = await walkFrontendFlow(createApiService(), name);
    assert.ok(svg.contents.length > 0, name);
  }
});

test('contract: adapter surfaces a route failure as a service error', async (t) => {
  routeFetch(t);
  const project = measured(await rendered());
  const stale = { ...project, transliteration: { ...project.transliteration, balineseUnicode: '\u1B05' } };
  await assert.rejects(createApiService().exportBoard(stale), { code: 'STALE_REVISION', message: 'Pratinjau mengacu pada hasil lama. Perbarui pratinjau terlebih dahulu.' });
});
