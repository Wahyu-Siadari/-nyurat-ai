import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SAMPLE_BALINESE, SAMPLE_NOTICE, DRAFT_NOTICE,
  createInitialProject, validateInput, validateLayout,
  invalidateInput, invalidateConfirmation, updateLayout,
  selectedPronunciations, validateSelections, confirmProject,
  getBoardModel, escapeXml, buildSvg, buildReviewPackage, consultationText,
} from '../src/lib/project.ts';

function proposedProject(name = 'Warung Sari') {
  const project = invalidateInput(createInitialProject(), {
    latinName: name, businessType: 'warung', sourceLanguage: null,
  });
  const provenance = {
    producer: 'fixture', delivery: 'fixture', providerId: null,
    modelVersion: null, artifactVersion: 'qa-fixture', sourceRefs: [],
  };
  project.proposal = {
    proposalId: 'qa-proposal', inputRevision: project.input.inputRevision,
    notationVersion: 'fixture-only', provenance, serviceState: 'not_called',
    tokens: [
      { tokenId: 'a', original: name, languageGuess: null,
        options: [{ optionId: 'a1', pronunciation: 'pelafalan contoh', reason: 'Fixture pengujian.' }],
        suggestedOptionId: 'a1', requiresConfirmation: true },
    ],
  };
  return project;
}

const selections = [{ tokenId: 'a', kind: 'option', optionId: 'a1' }];

function renderedProject(name) {
  const project = confirmProject(proposedProject(name), selections, '2026-11-04T00:00:00.000Z');
  project.transliteration = {
    resultId: 'qa-result', confirmationId: project.confirmation.confirmationId,
    balineseUnicode: SAMPLE_BALINESE, kind: 'layout_sample', matchesInput: false,
    engineVersion: null, rulesVersion: null, sourceRefs: [], unsupportedTokenIds: [],
    provenance: structuredClone(project.proposal.provenance),
  };
  project.render = {
    renderId: 'qa-render', basedOnRevision: project.revision, inputRevision: project.input.inputRevision,
    resultId: project.transliteration.resultId, layoutRevision: project.layout.layoutRevision,
  };
  project.checks.roundTrip = { status: 'unavailable', note: 'Belum ada engine.' };
  project.checks.layout = { status: 'pass', findings: [] };
  project.artifacts = [{ kind: 'svg', state: 'ready', basedOnRevision: project.revision, validation: 'not_tested' }];
  return project;
}

test('initial draft is empty and does not claim review or conversion', () => {
  const project = createInitialProject();
  assert.equal(project.input.latinName, '');
  assert.equal(project.proposal, null);
  assert.equal(project.confirmation, null);
  assert.equal(project.transliteration, null);
  assert.equal(project.languageReview.status, 'unreviewed');
  assert.equal(project.checks.roundTrip.status, 'not_run');
  assert.deepEqual(project.artifacts, []);
  const another = createInitialProject();
  project.layout.boardMm.width = 999;
  assert.equal(another.layout.boardMm.width, 1200);
});

test('name validation handles empty input, supported Latin names and the prototype limit', () => {
  const input = createInitialProject().input;
  for (const latinName of ['', '   ', '\t\n']) assert.ok(validateInput({ ...input, latinName }));
  for (const latinName of ['Café Sari 108', "Warung O'Neill & Putra", 'é'.repeat(120)]) {
    assert.equal(validateInput({ ...input, latinName }), null);
  }
  assert.ok(validateInput({ ...input, latinName: 'a'.repeat(121) }));
  assert.ok(validateInput({ ...input, latinName: '東京' }));
});

test('layout validation rejects non-finite sizes, exhausted margins, and invalid text sizes', () => {
  const layout = createInitialProject().layout;
  assert.equal(validateLayout(layout), null);
  assert.ok(validateLayout({ ...layout, boardMm: { width: NaN, height: 400 } }));
  assert.ok(validateLayout({ ...layout, marginMm: 200 }));
  assert.ok(validateLayout({ ...layout, marginMm: -1 }));
  assert.ok(validateLayout({ ...layout, latinSizeMm: 0 }));
  assert.ok(validateLayout({ ...layout, boardMm: { width: 99, height: 400 } }));
});

test('recommendation never substitutes for a valid explicit pronunciation choice', () => {
  const project = proposedProject();
  assert.ok(validateSelections(project, []));
  assert.ok(validateSelections(project, [{ tokenId: 'a', kind: 'option', optionId: 'missing' }]));
  assert.ok(validateSelections(project, [{ tokenId: 'a', kind: 'custom', pronunciation: '  ' }]));
  assert.ok(validateSelections(project, [{ tokenId: 'other', kind: 'option', optionId: 'a1' }]));
  assert.equal(validateSelections(project, selections), null);
  assert.throws(() => confirmProject(project, []));
  assert.equal(project.confirmation, null);
});

test('stale proposal cannot be confirmed against a newer input', () => {
  const project = proposedProject();
  project.input.inputRevision += 1;
  assert.ok(validateSelections(project, selections));
  assert.throws(() => confirmProject(project, selections));
});

test('custom pronunciation remains separate from the original Latin identity', () => {
  const project = proposedProject("O'Neill & Putra");
  const custom = [{ tokenId: 'a', kind: 'custom', pronunciation: '  pelafalan pemilik  ' }];
  const confirmed = confirmProject(project, custom, '2026-11-04T00:00:00.000Z');
  assert.deepEqual(selectedPronunciations(confirmed, custom), ['pelafalan pemilik']);
  assert.equal(confirmed.input.latinName, "O'Neill & Putra");
  assert.equal(confirmed.confirmation.inputRevision, project.input.inputRevision);
  assert.equal(confirmed.confirmation.confirmedAt, '2026-11-04T00:00:00.000Z');
  custom[0].pronunciation = 'diubah setelah konfirmasi';
  assert.equal(confirmed.confirmation.selections[0].pronunciation, '  pelafalan pemilik  ');
  assert.equal(confirmed.languageReview.status, 'unreviewed');
});

test('editing the Latin input invalidates every derived result without mutating the old draft', () => {
  const before = renderedProject();
  const next = invalidateInput(before, { latinName: 'Nama Baru', businessType: null, sourceLanguage: null });
  assert.equal(next.revision, before.revision + 1);
  assert.equal(next.input.inputRevision, before.input.inputRevision + 1);
  for (const field of ['proposal', 'confirmation', 'transliteration', 'render']) assert.equal(next[field], null);
  assert.deepEqual(next.artifacts, []);
  assert.equal(next.checks.roundTrip.status, 'not_run');
  assert.equal(next.languageReview.status, 'unreviewed');
  assert.equal(before.input.latinName, 'Warung Sari');
  assert.ok(before.render);
});

test('editing pronunciation invalidates conversion and files while retaining the proposal', () => {
  const before = renderedProject();
  const next = invalidateConfirmation(before);
  assert.equal(next.proposal.proposalId, before.proposal.proposalId);
  assert.equal(next.confirmation, null);
  assert.equal(next.transliteration, null);
  assert.equal(next.render, null);
  assert.deepEqual(next.artifacts, []);
  assert.equal(next.checks.roundTrip.status, 'not_run');
});

test('editing layout invalidates render and files but preserves confirmed pronunciation', () => {
  const before = renderedProject();
  const next = updateLayout(before, { ...before.layout, marginMm: 45 });
  assert.equal(next.layout.layoutRevision, before.layout.layoutRevision + 1);
  assert.equal(next.render, null);
  assert.deepEqual(next.artifacts, []);
  assert.equal(next.confirmation.confirmationId, before.confirmation.confirmationId);
  assert.equal(next.checks.layout.status, 'not_run');
  assert.throws(() => buildSvg(next));
});

test('XML escaping protects text delimiters and attribute quotes', () => {
  assert.equal(escapeXml(`A&B <tag> "double" 'single'`), 'A&amp;B &lt;tag&gt; &quot;double&quot; &apos;single&apos;');
});

test('export requires a complete snapshot', () => {
  assert.throws(() => buildSvg(createInitialProject()));
  assert.throws(() => buildReviewPackage(createInitialProject()));
});

test('SVG uses physical dimensions and keeps draft/specimen notices with escaped input', () => {
  const project = renderedProject(`O'Neill & <script>alert("x")</script>`);
  const svg = buildSvg(project);
  assert.match(svg, /width="1200mm" height="400mm" viewBox="0 0 1200 400"/);
  assert.ok(svg.includes(escapeXml(project.input.latinName)));
  assert.ok(!svg.includes('<script>'));
  assert.ok(svg.includes(SAMPLE_NOTICE));
  assert.ok(svg.includes(DRAFT_NOTICE));
  assert.ok(svg.includes(SAMPLE_BALINESE));
  const model = getBoardModel(project);
  assert.ok(svg.includes(`y="${model.sample.y}"`));
  assert.ok(svg.includes(`font-size="${model.latin[0].size}"`));
});

test('two-line layout preserves all original Latin words in order', () => {
  const project = renderedProject('Warung Sari Putra 108');
  project.layout.lineBreaks = 'two_lines';
  const model = getBoardModel(project);
  assert.equal(model.latin.length, 2);
  assert.equal(model.latin.map(line => line.text).join(' '), project.input.latinName);
});

test('review package is a frozen copy labelled unreviewed and not print-validated', () => {
  const project = renderedProject();
  const review = buildReviewPackage(project);
  assert.equal(review.status, 'data_contoh_belum_diperiksa_ahli');
  assert.equal(review.printReadiness, 'not_tested');
  assert.equal(review.sampleNotice, SAMPLE_NOTICE);
  project.input.latinName = 'Perubahan setelah snapshot';
  assert.equal(review.project.input.latinName, 'Warung Sari');
});

test('consultation text carries the original identity and honest sample status', () => {
  const project = renderedProject();
  const message = consultationText(project);
  assert.ok(message.includes(project.input.latinName));
  assert.ok(message.includes('pelafalan contoh'));
  assert.ok(message.includes('1200 × 400 mm'));
  assert.ok(message.includes(SAMPLE_NOTICE));
  assert.match(message, /belum diperiksa ahli/i);
});

test('export rejects render that belongs to an older input', () => {
  const project = renderedProject();
  project.render.inputRevision -= 1;
  assert.throws(() => buildSvg(project));
  assert.throws(() => buildReviewPackage(project));
});

test('export rejects render that belongs to an older layout', () => {
  const project = renderedProject();
  project.render.layoutRevision -= 1;
  assert.throws(() => buildSvg(project));
  assert.throws(() => buildReviewPackage(project));
});

test('export rejects a transliteration that belongs to a different confirmation', () => {
  const project = renderedProject();
  project.transliteration.confirmationId = 'older-confirmation';
  assert.throws(() => buildSvg(project));
  assert.throws(() => buildReviewPackage(project));
});

test('export rejects render that points at a different transliteration result', () => {
  const project = renderedProject();
  project.render.resultId = 'other-result';
  assert.throws(() => buildSvg(project));
  assert.throws(() => buildReviewPackage(project));
});

test('export rejects confirmation that belongs to an older input', () => {
  const project = renderedProject();
  project.confirmation.inputRevision -= 1;
  assert.throws(() => buildSvg(project));
  assert.throws(() => buildReviewPackage(project));
});

test('export rejects confirmation that belongs to a different proposal', () => {
  const project = renderedProject();
  project.confirmation.proposalId = 'older-proposal';
  assert.throws(() => buildSvg(project));
  assert.throws(() => buildReviewPackage(project));
});

test('export rejects a snapshot from an earlier overall project revision', () => {
  const project = renderedProject();
  project.revision += 1;
  assert.throws(() => buildSvg(project));
  assert.throws(() => buildReviewPackage(project));
});

test('font embedding accepts data URLs and rejects external URLs or injected markup', () => {
  const project = renderedProject();
  const font = 'data:font/woff2;base64,AAECAw==';
  assert.ok(buildSvg(project, { balinese: font, latin: font }).includes(font));
  assert.throws(() => buildSvg(project, { balinese: 'https://example.com/font.woff2', latin: font }));
  assert.throws(() => buildSvg(project, { balinese: `data:font/woff2;base64,AA')</style><script/>`, latin: font }));
});
