import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_PHOTO_BYTES, MAX_PHOTO_PIXELS, validatePhotoFile, validatePhotoDimensions,
  photoAnalysisSchema, getAuditSummary, requestPhotoAudit,
} from '../src/lib/photo-audit.ts';
import { createReviewRequest, reviewMatchesProject, decideReview } from '../src/lib/review.ts';
import { getPdfPreviewSize } from '../src/lib/pdf-layout.ts';
import { createDraftPdf } from '../src/lib/pdf-export.ts';
import {
  createInitialProject, invalidateInput, invalidateConfirmation, updateLayout,
  confirmProject, buildReviewPackage, isLayoutSample, getBoardNotice, getDraftNotice,
  getBoardModel, buildSvg, consultationText, SAMPLE_NOTICE, DRAFT_NOTICE,
} from '../src/lib/project.ts';
import { createFixtureAudit, createFixtureProposal, fixtureService } from '../src/lib/mock.ts';
import { renderResultSchema } from '../src/lib/contract.ts';

const requestedAt = '2026-11-05T08:00:00.000Z';
const decidedAt = '2026-11-05T08:05:00.000Z';

async function renderedProject() {
  let project = invalidateInput(createInitialProject(), {
    latinName: 'Warung Sari', businessType: 'warung', sourceLanguage: null,
  });
  project.proposal = createFixtureProposal(project);
  project = confirmProject(project, project.proposal.tokens.map(token => ({
    tokenId: token.tokenId, kind: 'option', optionId: token.options[0].optionId,
  })), requestedAt);
  return Object.assign(project, await fixtureService.renderBoard(project, 'normal'));
}

function photoResponse(data, status = 200) {
  return new Response(JSON.stringify({ ok: status === 200, data }), {
    status, headers: { 'content-type': 'application/json' },
  });
}

test('photo validation accepts supported MIME types at the exact byte limit', () => {
  assert.equal(MAX_PHOTO_BYTES, 10 * 1024 * 1024);
  for (const type of ['image/jpeg', 'image/png', 'image/webp']) {
    assert.equal(validatePhotoFile({ type, size: MAX_PHOTO_BYTES, name: 'papan' }), null);
  }
});

test('photo validation rejects unsupported, empty, oversized and invalid files', () => {
  for (const type of ['', 'image/svg+xml', 'image/gif', 'text/plain']) {
    assert.ok(validatePhotoFile({ type, size: 100, name: 'papan.jpg' }));
  }
  for (const size of [0, -1, MAX_PHOTO_BYTES + 1, NaN, Infinity]) {
    assert.ok(validatePhotoFile({ type: 'image/png', size, name: 'papan.png' }));
  }
});

test('photo dimensions enforce minimum decoded size and the exact pixel budget', () => {
  assert.equal(MAX_PHOTO_PIXELS, 24_000_000);
  assert.equal(validatePhotoDimensions(64, 64), null);
  assert.equal(validatePhotoDimensions(6000, 4000), null);
  assert.ok(validatePhotoDimensions(6001, 4000));
  for (const [width, height] of [[63, 64], [64, 63], [0, 100], [-1, 100], [100.5, 100], [NaN, 100], [100, Infinity]]) {
    assert.ok(validatePhotoDimensions(width, height), `${width} × ${height}`);
  }
});

test('every audit fixture remains explicitly prewritten and unverified', () => {
  for (const scenario of ['balanced', 'missing_bali', 'no_detection', 'uncertain']) {
    const result = createFixtureAudit(scenario, 7);
    assert.equal(photoAnalysisSchema.safeParse(result).success, true);
    assert.equal(result.photoRevision, 7);
    assert.equal(result.provenance.producer, 'fixture');
    assert.equal(result.provenance.delivery, 'fixture');
    assert.equal(result.provenance.providerId, null);
    assert.equal(result.provenance.modelVersion, null);
    assert.match(result.note, /bukan pengenalan foto/i);
    assert.match(result.note, /belum diperiksa ahli/i);
  }
});

test('audit contract rejects boxes outside the image and invalid revisions', () => {
  const valid = createFixtureAudit('balanced');
  for (const box of [
    { x: -.01, y: 0, width: .5, height: .5 },
    { x: .8, y: .1, width: .3, height: .3 },
    { x: .1, y: .8, width: .3, height: .3 },
    { x: 0, y: 0, width: 0, height: .5 },
    { x: 0, y: 0, width: .5, height: Infinity },
  ]) {
    const result = structuredClone(valid);
    result.detections[0].box = box;
    assert.equal(photoAnalysisSchema.safeParse(result).success, false);
  }
  assert.equal(photoAnalysisSchema.safeParse({ ...valid, photoRevision: 0 }).success, false);
  assert.equal(photoAnalysisSchema.safeParse({ ...valid, photoRevision: 1.5 }).success, false);
});

test('audit contract rejects ambiguous area identities and contradictory no-detection status', () => {
  const valid = createFixtureAudit('balanced');
  const duplicate = structuredClone(valid);
  duplicate.detections[1].id = duplicate.detections[0].id;
  assert.equal(photoAnalysisSchema.safeParse(duplicate).success, false);
  assert.equal(photoAnalysisSchema.safeParse({ ...valid, status: 'no_detection' }).success, false);
  assert.equal(photoAnalysisSchema.safeParse(createFixtureAudit('no_detection')).success, true);
});

test('audit contract bounds area count before rendering a large detection response', () => {
  const valid = createFixtureAudit('balanced');
  const detections = Array.from({ length: 200 }, (_, index) => ({ ...valid.detections[0], id: `area-${index}` }));
  assert.equal(photoAnalysisSchema.safeParse({ ...valid, detections }).success, true);
  assert.equal(photoAnalysisSchema.safeParse({ ...valid, detections: [...detections, { ...detections[0], id: 'extra-area' }] }).success, false);
});

test('audit summary withholds ratio and position when evidence is absent or uncertain', () => {
  for (const scenario of ['missing_bali', 'no_detection', 'uncertain']) {
    const summary = getAuditSummary(createFixtureAudit(scenario));
    assert.equal(summary.ratio, null, scenario);
    assert.equal(summary.position, 'unavailable', scenario);
  }
  const none = getAuditSummary(createFixtureAudit('no_detection'));
  assert.equal(none.latinCount, 0);
  assert.equal(none.balineseCount, 0);
});

test('audit summary reports box-height comparisons without claiming font size or compliance', () => {
  const result = createFixtureAudit('balanced');
  const summary = getAuditSummary(result);
  assert.equal(summary.latinCount, 1);
  assert.equal(summary.balineseCount, 1);
  assert.ok(Math.abs(summary.ratio - .25 / .14) < 1e-12);
  assert.equal(summary.position, 'bali_above');
  assert.match(summary.note, /bukan ukuran font.*ukuran fisik.*kepatuhan/i);
  const reversed = structuredClone(result);
  reversed.detections[0].box.y = .6;
  reversed.detections[1].box.y = .1;
  assert.equal(getAuditSummary(reversed).position, 'latin_above');
  reversed.detections[0].box.y = .1;
  assert.equal(getAuditSummary(reversed).position, 'unclear');
});

test('audit API sends the selected file with its revision and accepts the matching result', async (t) => {
  const file = new File(['test image payload'], 'papan.png', { type: 'image/png' });
  const result = createFixtureAudit('balanced', 3);
  let request;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    request = { url, options };
    return photoResponse(result);
  });
  const actual = await requestPhotoAudit(file, 3, new AbortController().signal);
  assert.equal(request.url, '/api/v1/photo-audits');
  assert.equal(request.options.method, 'POST');
  assert.equal(request.options.body.get('photoRevision'), '3');
  assert.equal(request.options.body.get('photo').name, 'papan.png');
  assert.equal(actual.analysisId, result.analysisId);
});

test('audit API rejects stale results instead of applying an earlier photo', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => photoResponse(createFixtureAudit('balanced', 1)));
  const file = new File(['test'], 'papan.png', { type: 'image/png' });
  await assert.rejects(requestPhotoAudit(file, 2, new AbortController().signal), { code: 'STALE_REVISION' });
});

test('audit API surfaces malformed and unavailable responses without substituting fixtures', async (t) => {
  const file = new File(['test'], 'papan.png', { type: 'image/png' });
  const mockFetch = t.mock.method(globalThis, 'fetch', async () => new Response('<html>offline</html>', { status: 503 }));
  await assert.rejects(requestPhotoAudit(file, 1, new AbortController().signal), { code: 'INVALID_AUDIT_OUTPUT' });
  mockFetch.mock.mockImplementation(async () => photoResponse({ detections: [] }));
  await assert.rejects(requestPhotoAudit(file, 1, new AbortController().signal), { code: 'AUDIT_UNAVAILABLE' });
  mockFetch.mock.mockImplementation(async () => { throw new TypeError('offline'); });
  await assert.rejects(requestPhotoAudit(file, 1, new AbortController().signal), { code: 'AUDIT_UNAVAILABLE' });
});

test('review request requires a complete current snapshot', () => {
  assert.throws(() => createReviewRequest(createInitialProject(), '', requestedAt));
});

test('review request captures a revision-bound simulation without mutating the project', async () => {
  const project = await renderedProject();
  const before = structuredClone(project);
  const record = createReviewRequest(project, '  Mohon periksa ejaan.  ', requestedAt);
  assert.equal(record.status, 'requested');
  assert.equal(record.simulation, true);
  assert.equal(record.languageVerification, 'unverified');
  assert.equal(record.snapshot.revision, project.revision);
  assert.equal(record.snapshot.latinName, project.input.latinName);
  assert.equal(record.requestNotes, 'Mohon periksa ejaan.');
  assert.equal(record.decidedAt, null);
  assert.equal(reviewMatchesProject(record, project), true);
  assert.deepEqual(project, before);
});

test('review decisions reject changed input, pronunciation, layout and snapshot identities', async () => {
  const project = await renderedProject();
  const record = createReviewRequest(project, '', requestedAt);
  const altered = [
    invalidateInput(project, { latinName: 'Nama Baru', businessType: null, sourceLanguage: null }),
    invalidateConfirmation(project),
    updateLayout(project, { ...project.layout, marginMm: 45 }),
  ];
  for (const field of ['projectId', 'revision', 'inputRevision', 'layoutRevision', 'resultId', 'renderId']) {
    const staleRecord = structuredClone(record);
    staleRecord.snapshot[field] = `different-${field}`;
    assert.equal(reviewMatchesProject(staleRecord, project), false, field);
    assert.throws(() => decideReview(staleRecord, project, 'demo_approved', '', decidedAt), undefined, field);
  }
  for (const next of altered) {
    assert.equal(reviewMatchesProject(record, next), false);
    assert.throws(() => decideReview(record, next, 'demo_approved', '', decidedAt));
  }
});

test('change requests require a useful note and cannot be decided twice', async () => {
  const project = await renderedProject();
  const record = createReviewRequest(project, '', requestedAt);
  assert.throws(() => decideReview(record, project, 'changes_requested', '   ', decidedAt));
  const decided = decideReview(record, project, 'changes_requested', '  Ubah jarak teks.  ', decidedAt);
  assert.equal(decided.decisionNotes, 'Ubah jarak teks.');
  assert.equal(decided.status, 'changes_requested');
  assert.equal(record.status, 'requested');
  assert.throws(() => decideReview(decided, project, 'demo_approved', '', decidedAt));
});

test('demo approval never becomes expert verification or print validation', async () => {
  const project = await renderedProject();
  const record = createReviewRequest(project, '', requestedAt);
  const decided = decideReview(record, project, 'demo_approved', 'Contoh keputusan.', decidedAt);
  assert.equal(decided.status, 'demo_approved');
  assert.equal(decided.simulation, true);
  assert.equal(decided.languageVerification, 'unverified');
  assert.equal(decided.decidedAt, decidedAt);
  assert.equal(project.languageReview.status, 'unreviewed');
  const pack = buildReviewPackage(project);
  assert.equal(pack.printReadiness, 'not_tested');
  assert.match(pack.status, /belum_diperiksa_ahli/);
});

test('round-trip contract preserves each distinct status without promoting it to pass', async () => {
  const project = await renderedProject();
  const result = { transliteration: project.transliteration, render: project.render, checks: project.checks };
  for (const status of ['not_run', 'unavailable', 'pass', 'mismatch', 'error']) {
    const actual = renderResultSchema.parse({ ...result, checks: { ...result.checks, roundTrip: { status, note: 'Status pengujian.' } } });
    assert.equal(actual.checks.roundTrip.status, status);
  }
  assert.equal(renderResultSchema.safeParse({ ...result, checks: { ...result.checks, roundTrip: { status: 'verified', note: '' } } }).success, false);
});

test('round-trip contract retains the compared Latin texts without hiding a mismatch', async () => {
  const project = await renderedProject();
  const check = { status: 'mismatch', note: 'Teks berbeda.', originalLatin: 'Warung Sari', returnedLatin: 'Warung Sari Baru' };
  const result = renderResultSchema.parse({
    transliteration: project.transliteration, render: project.render,
    checks: { ...project.checks, roundTrip: check },
  });
  assert.deepEqual(result.checks.roundTrip, check);
});

test('fixture results keep sample and unreviewed notices in every export-facing model', async () => {
  const project = await renderedProject();
  assert.equal(isLayoutSample(project), true);
  assert.equal(getBoardNotice(project), SAMPLE_NOTICE);
  assert.equal(getDraftNotice(project), DRAFT_NOTICE);
  assert.ok(getBoardModel(project).notes.some(note => note.text === DRAFT_NOTICE));
  assert.ok(buildSvg(project).includes(SAMPLE_NOTICE));
  assert.ok(consultationText(project).includes(SAMPLE_NOTICE));
});

test('real service results are distinguished from fixed fixtures while remaining unreviewed', async () => {
  const project = await renderedProject();
  project.transliteration.kind = 'transliteration';
  project.transliteration.matchesInput = true;
  project.transliteration.provenance = {
    ...project.transliteration.provenance, producer: 'rules', delivery: 'fresh',
    artifactVersion: 'qa-engine-result',
  };
  assert.equal(isLayoutSample(project), false);
  assert.notEqual(getBoardNotice(project), SAMPLE_NOTICE);
  assert.notEqual(getDraftNotice(project), DRAFT_NOTICE);
  assert.match(getBoardNotice(project), /belum diperiksa ahli/i);
  assert.match(getDraftNotice(project), /belum diperiksa ahli/i);
  const pack = buildReviewPackage(project);
  assert.equal(pack.status, 'draf_belum_diperiksa_ahli');
  assert.equal(pack.printReadiness, 'not_tested');
  assert.ok(!buildSvg(project).includes(SAMPLE_NOTICE));
  assert.ok(!consultationText(project).includes(SAMPLE_NOTICE));
  project.transliteration.matchesInput = false;
  assert.equal(isLayoutSample(project), true);
  assert.equal(getBoardNotice(project), SAMPLE_NOTICE);
});

test('PDF preview raster is bounded for square, wide, tall and extreme board dimensions', () => {
  for (const [width, height] of [[1200, 400], [100, 100], [10000, 10000], [10000, 100], [100, 10000], [1e9, 1]]) {
    const raster = getPdfPreviewSize(width, height);
    assert.ok(Number.isInteger(raster.width) && raster.width >= 1 && raster.width <= 4096);
    assert.ok(Number.isInteger(raster.height) && raster.height >= 1 && raster.height <= 4096);
    assert.ok(raster.width * raster.height <= 4_000_000);
    assert.ok(raster.scale > 0 && raster.scale <= 3);
    assert.ok(Math.abs(raster.width - width * raster.scale) <= 1);
    assert.ok(Math.abs(raster.height - height * raster.scale) <= 1);
  }
});

test('PDF preview sizing rejects invalid physical dimensions before raster allocation', () => {
  for (const [width, height] of [[0, 400], [1200, 0], [-1, 400], [NaN, 400], [1200, Infinity]]) {
    assert.throws(() => getPdfPreviewSize(width, height));
  }
});

test('PDF export refuses incomplete and stale snapshots before accessing browser canvas', async () => {
  await assert.rejects(createDraftPdf(createInitialProject(), { fontsReady: true }), { code: 'INVALID_PDF_SNAPSHOT' });
  for (const field of ['revision', 'inputRevision', 'layoutRevision']) {
    const project = await renderedProject();
    if (field === 'revision') project.revision += 1;
    if (field === 'inputRevision') project.input.inputRevision += 1;
    if (field === 'layoutRevision') project.layout.layoutRevision += 1;
    await assert.rejects(createDraftPdf(project, { fontsReady: true }), { code: 'INVALID_PDF_SNAPSHOT' }, field);
  }
});

test('PDF export refuses invalid layout and unavailable fonts before raster allocation', async () => {
  const project = await renderedProject();
  await assert.rejects(createDraftPdf(project, { fontsReady: false }), { code: 'PDF_FONT_NOT_READY' });
  const invalid = structuredClone(project);
  invalid.layout.boardMm.width = Infinity;
  await assert.rejects(createDraftPdf(invalid, { fontsReady: true }), { code: 'INVALID_PDF_SNAPSHOT' });
});

test('PDF export honors an already cancelled request without starting browser work', async () => {
  const project = await renderedProject();
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(createDraftPdf(project, { fontsReady: true, signal: controller.signal }), { name: 'AbortError' });
});
