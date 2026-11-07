import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiService } from '../src/lib/api-service.ts';
import { createFixtureProposal, fixtureService } from '../src/lib/mock.ts';
import { createInitialProject, invalidateInput, confirmProject } from '../src/lib/project.ts';

function projectFor(name = 'Café Sari 108') {
  return invalidateInput(createInitialProject(), { latinName: name, businessType: null, sourceLanguage: null });
}

function response(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
}

function envelope(project, data) {
  return { ok: true, schemaVersion: '0.1-draft', requestId: 'qa-request', projectId: project.projectId, revision: project.revision, data };
}

test('fixture proposal preserves input token order and never pretends to have called AI', () => {
  const project = projectFor();
  const proposal = createFixtureProposal(project);
  assert.deepEqual(proposal.tokens.map(token => token.original), ['Café', 'Sari', '108']);
  assert.ok(proposal.tokens.every(token => token.requiresConfirmation && token.suggestedOptionId === null));
  assert.equal(proposal.provenance.producer, 'fixture');
  assert.equal(proposal.provenance.delivery, 'fixture');
  assert.equal(proposal.serviceState, 'not_called');
  assert.equal(proposal.provenance.providerId, null);
  assert.equal(proposal.inputRevision, project.input.inputRevision);
});

test('fallback simulation keeps quota failure visible and still identifies itself as fixture', () => {
  const proposal = createFixtureProposal(projectFor(), true);
  assert.equal(proposal.serviceState, 'quota_exhausted');
  assert.equal(proposal.provenance.producer, 'fixture');
  assert.equal(proposal.provenance.delivery, 'fixture');
});

test('fixture render is explicitly a non-matching sample for any entered business name', async () => {
  let project = projectFor('Nama Baru Bebas 108');
  project.proposal = createFixtureProposal(project);
  const selections = project.proposal.tokens.map(token => ({ tokenId: token.tokenId, kind: 'option', optionId: token.options[0].optionId }));
  project = confirmProject(project, selections);
  const result = await fixtureService.renderBoard(project, 'normal');
  assert.equal(result.transliteration.kind, 'layout_sample');
  assert.equal(result.transliteration.matchesInput, false);
  assert.equal(result.transliteration.engineVersion, null);
  assert.equal(result.transliteration.rulesVersion, null);
  assert.deepEqual(result.transliteration.unsupportedTokenIds, project.proposal.tokens.map(token => token.tokenId));
  assert.equal(result.render.basedOnRevision, project.revision);
  assert.equal(result.checks.roundTrip.status, 'unavailable');
});

test('timeout and quota simulations fail without substituting a successful proposal', async () => {
  const project = projectFor();
  await assert.rejects(fixtureService.suggestPronunciation(project, 'timeout'), { code: 'AI_TIMEOUT' });
  await assert.rejects(fixtureService.suggestPronunciation(project, 'quota'), { code: 'QUOTA_EXHAUSTED' });
  assert.equal(project.proposal, null);
});

test('API adapter sends the current snapshot and validates a successful proposal', async (t) => {
  const project = projectFor();
  let call;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    call = { url, options };
    return response(envelope(project, createFixtureProposal(project)));
  });
  const proposal = await createApiService('/api/qa').suggestPronunciation(project, 'normal');
  assert.equal(call.url, '/api/qa/pronunciation-proposals');
  assert.equal(call.options.method, 'POST');
  assert.equal(JSON.parse(call.options.body).project.input.latinName, project.input.latinName);
  assert.equal(JSON.parse(call.options.body).revision, project.revision);
  assert.equal(proposal.proposalId, createFixtureProposal(project).proposalId);
});

test('API adapter rejects wrong revision instead of accepting a stale response', async (t) => {
  const project = projectFor();
  t.mock.method(globalThis, 'fetch', async () => response({ ...envelope(project, createFixtureProposal(project)), revision: project.revision - 1 }));
  await assert.rejects(createApiService().suggestPronunciation(project, 'normal'), { code: 'STALE_REVISION' });
});

test('API adapter rejects malformed envelopes and invalid structured results', async (t) => {
  const project = projectFor();
  const mockFetch = t.mock.method(globalThis, 'fetch', async () => response({ text: 'not the NYURAT contract' }));
  await assert.rejects(createApiService().suggestPronunciation(project, 'normal'), { code: 'INVALID_API_OUTPUT' });
  mockFetch.mock.mockImplementation(async () => response(envelope(project, { proposalId: 'missing-tokens' })));
  await assert.rejects(createApiService().suggestPronunciation(project, 'normal'), { code: 'INVALID_API_OUTPUT' });
});

test('API adapter preserves upstream quota errors without pretending a fixture result', async (t) => {
  const project = projectFor();
  t.mock.method(globalThis, 'fetch', async () => response({ ok: false, schemaVersion: '0.1-draft', requestId: 'quota', error: { code: 'QUOTA_EXHAUSTED', message: 'Kuota habis.', retryable: false } }, 429));
  await assert.rejects(createApiService().suggestPronunciation(project, 'normal'), { code: 'QUOTA_EXHAUSTED', message: 'Kuota habis.' });
  assert.equal(project.proposal, null);
});

test('API network and non-JSON failures produce recoverable errors without losing input', async (t) => {
  const project = projectFor();
  const mockFetch = t.mock.method(globalThis, 'fetch', async () => { throw new TypeError('offline'); });
  await assert.rejects(createApiService().suggestPronunciation(project, 'normal'), { code: 'UPSTREAM_UNAVAILABLE' });
  mockFetch.mock.mockImplementation(async () => new Response('<html>Unavailable</html>', { status: 503 }));
  await assert.rejects(createApiService().suggestPronunciation(project, 'normal'), { code: 'INVALID_API_OUTPUT' });
  assert.equal(project.input.latinName, 'Café Sari 108');
});

test('normal fixture proposal does not wait on an artificial timer', async (t) => {
  t.mock.method(globalThis, 'setTimeout', () => { throw new Error('Normal fixture work must not schedule an artificial delay.'); });
  const proposal = await fixtureService.suggestPronunciation(projectFor(), 'normal');
  assert.equal(proposal.provenance.producer, 'fixture');
  assert.equal(proposal.serviceState, 'not_called');
});

test('normal fixture render does not wait on an artificial timer', async (t) => {
  let project = projectFor();
  project.proposal = createFixtureProposal(project);
  const selections = project.proposal.tokens.map(token => ({ tokenId: token.tokenId, kind: 'option', optionId: token.options[0].optionId }));
  project = confirmProject(project, selections);
  t.mock.method(globalThis, 'setTimeout', () => { throw new Error('Normal fixture work must not schedule an artificial delay.'); });
  const result = await fixtureService.renderBoard(project, 'normal');
  assert.equal(result.transliteration.matchesInput, false);
  assert.equal(result.render.basedOnRevision, project.revision);
});
