import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import sharp from 'sharp';
import { getAuditSummary, MAX_PHOTO_BYTES, photoAnalysisSchema, requestPhotoAudit } from '../src/lib/photo-audit.ts';
import * as route from '../src/app/api/v1/photo-audits/route.ts';
import { DEFAULT_GEMINI_MODEL, resetConfigForTests } from '../src/server/config.ts';
import { setGeminiSdkForTests } from '../src/server/gemini/client.ts';
import { rateLimiter } from '../src/server/http/rate-limit.ts';
import { PHOTO_TIMEOUT_MS, toNormalizedBox } from '../src/server/photo/gemini-detector.ts';
import { sniffFormat } from '../src/server/photo/inspect.ts';

const URL_PHOTO = 'http://nyurat.test/api/v1/photo-audits';
const NOTE = 'Area tulisan dideteksi otomatis oleh model AI dan dapat keliru. Teks aksara Bali belum diverifikasi. Belum diperiksa ahli.';
const forbiddenSdk = { models: { generateContent: async () => { throw new Error('Tes tidak boleh memanggil Gemini sungguhan.'); } } };

beforeEach(() => {
  delete process.env.GEMINI_API_KEY;
  resetConfigForTests();
  setGeminiSdkForTests(forbiddenSdk);
  rateLimiter.reset();
});

function useGemini(t, generateContent) {
  process.env.GEMINI_API_KEY = 'kunci-uji';
  resetConfigForTests();
  const sdk = { calls: [], models: { generateContent: async (params) => { sdk.calls.push(params); return generateContent(params); } } };
  setGeminiSdkForTests(sdk);
  t.mock.method(console, 'error', () => {});
  return sdk;
}

function areas(list) {
  return () => ({ text: JSON.stringify({ areas: list }) });
}

const LATIN = { script: 'latin', text: 'WARUNG SARI', box_2d: [520, 200, 660, 800], confidence: 'high' };
const BALI = { script: 'balinese', text: '\u1B2F\u1B2D\u1B38\u1B02', box_2d: [200, 200, 450, 800], confidence: 'high' };

async function makeImage(format = 'jpeg', { width = 200, height = 100, orientation, background = '#b33' } = {}) {
  const image = sharp({ create: { width, height, channels: 3, background } }).toFormat(format);
  return (orientation ? image.withMetadata({ orientation }) : image).toBuffer();
}

function formRequest({ bytes, type = 'image/jpeg', name = 'papan.jpg', revision = '1' }) {
  const form = new FormData();
  if (bytes !== undefined) form.append('photo', new File([bytes], name, { type }));
  if (revision !== null) form.append('photoRevision', revision);
  return new Request(URL_PHOTO, { method: 'POST', body: form });
}

async function post(options) {
  const response = await route.POST(formRequest(options));
  return { response, body: await response.json() };
}

function assertFailure({ response, body }, status, code) {
  assert.equal(response.status, status, JSON.stringify(body));
  assert.equal(body.ok, false);
  assert.equal(body.schemaVersion, '0.1-draft');
  assert.equal(body.error.code, code);
  assert.equal(typeof body.error.message, 'string');
  assert.equal(typeof body.error.retryable, 'boolean');
  assert.equal(Object.hasOwn(body, 'data'), false, 'a failure must not carry a substitute result');
  assert.equal(response.headers.get('x-request-id'), body.requestId);
  assert.equal(response.headers.get('cache-control'), 'no-store');
}

function sentImage(sdk) {
  const [{ inlineData }] = sdk.calls[0].contents[0].parts;
  assert.equal(inlineData.mimeType, 'image/jpeg');
  return Buffer.from(inlineData.data, 'base64');
}

test('declares its runtime and segment config', () => {
  assert.equal(route.runtime, 'nodejs');
  assert.equal(route.dynamic, 'force-dynamic');
  assert.ok(route.maxDuration >= 15 && route.maxDuration <= 60);
});

test('a detected board returns the full analysis', async (t) => {
  useGemini(t, areas([BALI, LATIN]));
  const { response, body } = await post({ bytes: await makeImage(), revision: '7' });
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.ok, true);
  assert.equal(response.headers.get('x-request-id'), body.requestId);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const data = photoAnalysisSchema.parse(body.data);
  assert.equal(data.analysisId, `audit-7-${body.requestId.slice(0, 8)}`);
  assert.equal(data.photoRevision, 7);
  assert.deepEqual(data.image, { width: 200, height: 100 });
  assert.equal(data.status, 'detected');
  assert.equal(data.note, NOTE);
  assert.deepEqual(data.provenance, { producer: 'ai', delivery: 'fresh', providerId: 'google', modelVersion: DEFAULT_GEMINI_MODEL, artifactVersion: 'nyurat-photo-audit-0.1.0', sourceRefs: [] });
  assert.deepEqual(data.detections.map((item) => [item.id, item.script, item.uncertain]), [['bali-1', 'balinese', false], ['latin-1', 'latin', false]]);
  assert.deepEqual(data.detections[1].box, { x: 0.2, y: 0.52, width: 0.6, height: 0.14 });
});

test('magic bytes decide the format, not the declared type', async (t) => {
  useGemini(t, areas([]));
  assert.equal((await post({ bytes: await makeImage('png'), type: 'image/jpeg' })).response.status, 200);
  assert.equal((await post({ bytes: await makeImage('webp'), type: 'text/plain', name: 'papan.txt' })).response.status, 200);
});

test('files that only claim to be images are refused with 415', async () => {
  const fakes = [
    Buffer.from('ini bukan gambar sama sekali'),
    Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
    Buffer.from('GIF89a\x01\x00\x01\x00'),
    Buffer.from('RIFF\x00\x00\x00\x00WAVEfmt '),
    Buffer.from([0xff, 0xd8]),
    await sharp({ create: { width: 80, height: 80, channels: 3, background: '#000' } }).gif().toBuffer(),
    await sharp({ create: { width: 80, height: 80, channels: 3, background: '#000' } }).tiff().toBuffer(),
  ];
  for (const bytes of fakes) assertFailure(await post({ bytes, type: 'image/png', name: 'papan.png' }), 415, 'UNSUPPORTED_MEDIA_TYPE');
});

test('magic byte sniffing recognizes the three formats', async () => {
  assert.equal(sniffFormat(await makeImage('jpeg')), 'jpeg');
  assert.equal(sniffFormat(await makeImage('png')), 'png');
  assert.equal(sniffFormat(await makeImage('webp')), 'webp');
  assert.equal(sniffFormat(Buffer.from('RIFF')), null);
  assert.equal(sniffFormat(Buffer.alloc(0)), null);
});

test('EXIF orientation 5 to 8 swaps the JPEG size, 1 to 4 does not', async (t) => {
  useGemini(t, areas([]));
  for (const orientation of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const { body } = await post({ bytes: await makeImage('jpeg', { orientation }) });
    assert.deepEqual(body.data.image, orientation >= 5 ? { width: 100, height: 200 } : { width: 200, height: 100 }, `orientasi ${orientation}`);
  }
});

test('PNG follows EXIF like the browser, and WebP stays as stored like the browser', async (t) => {
  const sdk = useGemini(t, areas([]));
  assert.deepEqual((await post({ bytes: await makeImage('png', { orientation: 6 }) })).body.data.image, { width: 100, height: 200 });
  assert.deepEqual((await post({ bytes: await makeImage('webp', { orientation: 6 }) })).body.data.image, { width: 200, height: 100 });
  const webpSent = await sharp(Buffer.from(sdk.calls[1].contents[0].parts[0].inlineData.data, 'base64')).metadata();
  assert.deepEqual([webpSent.width, webpSent.height], [200, 100], 'pixels sent must match the size reported');
});

test('the model sees the photo the way the browser shows it', async (t) => {
  const sdk = useGemini(t, areas([]));
  const white = await sharp({ create: { width: 40, height: 20, channels: 3, background: '#fff' } }).png().toBuffer();
  const bytes = await sharp({ create: { width: 200, height: 100, channels: 3, background: '#000' } }).composite([{ input: white, left: 0, top: 0 }]).jpeg().withMetadata({ orientation: 6 }).toBuffer();
  await post({ bytes });
  const sent = sentImage(sdk);
  const meta = await sharp(sent).metadata();
  assert.deepEqual([meta.width, meta.height], [100, 200]);
  const { data, info } = await sharp(sent).raw().toBuffer({ resolveWithObject: true });
  const brightness = (x, y) => data[(y * info.width + x) * info.channels];
  assert.ok(brightness(90, 10) > 200, 'orientation 6 turns the top-left corner to the top right');
  assert.ok(brightness(10, 10) < 60);
});

test('a large photo is reduced to 1600 px, and a small one is not enlarged', async (t) => {
  const sdk = useGemini(t, areas([]));
  await post({ bytes: await makeImage('jpeg', { width: 4000, height: 2000 }) });
  const large = await sharp(sentImage(sdk)).metadata();
  assert.deepEqual([large.width, large.height], [1600, 800]);
  sdk.calls.length = 0;
  await post({ bytes: await makeImage('jpeg', { width: 300, height: 200 }) });
  const small = await sharp(sentImage(sdk)).metadata();
  assert.deepEqual([small.width, small.height], [300, 200]);
});

test('the reported size is the original, not the reduced copy', async (t) => {
  useGemini(t, areas([]));
  const { body } = await post({ bytes: await makeImage('jpeg', { width: 4000, height: 2000 }) });
  assert.deepEqual(body.data.image, { width: 4000, height: 2000 });
});

test('metadata such as GPS never reaches the provider', async (t) => {
  const sdk = useGemini(t, areas([]));
  const bytes = await sharp({ create: { width: 200, height: 100, channels: 3, background: '#b33' } }).jpeg().withExif({ IFD3: { GPSLatitudeRef: 'S', GPSLatitude: '8/1 39/1 0/1' }, IFD0: { Copyright: 'Rahasia' } }).toBuffer();
  assert.ok((await sharp(bytes).metadata()).exif, 'the sample must carry EXIF');
  await post({ bytes });
  const sent = await sharp(sentImage(sdk)).metadata();
  assert.equal(sent.exif, undefined);
  assert.equal(sentImage(sdk).includes('Rahasia'), false);
});

test('transparency becomes white instead of black', async (t) => {
  const sdk = useGemini(t, areas([]));
  await post({ bytes: await sharp({ create: { width: 100, height: 100, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer(), type: 'image/png' });
  const { data } = await sharp(sentImage(sdk)).raw().toBuffer({ resolveWithObject: true });
  assert.ok(data[0] > 240);
});

test('dimension limits use the oriented size', async (t) => {
  const small = await post({ bytes: await makeImage('jpeg', { width: 63, height: 64 }) });
  assertFailure(small, 400, 'INVALID_INPUT');
  assert.equal(small.body.error.message, 'Gambar minimal 64 × 64 piksel. Pilih foto papan yang lebih jelas.');
  assertFailure(await post({ bytes: await makeImage('jpeg', { width: 64, height: 63, orientation: 6 }) }), 400, 'INVALID_INPUT');
  const tooMany = await post({ bytes: await makeImage('png', { width: 6000, height: 4001 }), type: 'image/png' });
  assertFailure(tooMany, 400, 'INVALID_INPUT');
  assert.equal(tooMany.body.error.message, 'Resolusi foto maksimal 24 megapiksel. Kecilkan gambar lalu coba lagi.');
  useGemini(t, areas([]));
  assert.equal((await post({ bytes: await makeImage('jpeg', { width: 64, height: 64 }) })).response.status, 200);
  assert.equal((await post({ bytes: await makeImage('png', { width: 6000, height: 4000 }), type: 'image/png' })).response.status, 200);
});

test('photoRevision must be a plain safe integer of at least 1', async () => {
  const bytes = await makeImage();
  for (const revision of ['0', '-1', '1.5', 'abc', '', '1e3', ' 3', '0x10', '+2', '007', '9007199254740993']) {
    rateLimiter.reset();
    const failure = await post({ bytes, revision });
    assertFailure(failure, 400, 'INVALID_INPUT');
    assert.equal(failure.body.error.message, 'Revisi foto tidak valid.', JSON.stringify(revision));
  }
  rateLimiter.reset();
  assertFailure(await post({ bytes, revision: null }), 400, 'INVALID_INPUT');
});

test('the largest safe revision is accepted', async (t) => {
  useGemini(t, areas([]));
  assert.equal((await post({ bytes: await makeImage(), revision: '9007199254740991' })).body.data.photoRevision, 9007199254740991);
});

test('a missing, text, or empty photo is refused', async () => {
  assertFailure(await post({ bytes: undefined }), 400, 'INVALID_INPUT');
  const form = new FormData();
  form.append('photo', 'bukan berkas');
  form.append('photoRevision', '1');
  const response = await route.POST(new Request(URL_PHOTO, { method: 'POST', body: form }));
  assertFailure({ response, body: await response.json() }, 400, 'INVALID_INPUT');
  assertFailure(await post({ bytes: Buffer.alloc(0) }), 400, 'INVALID_INPUT');
});

test('a photo of exactly 10 MB is read, and one byte more is refused', async (t) => {
  useGemini(t, areas([]));
  const image = await makeImage();
  const exact = Buffer.concat([image, Buffer.alloc(MAX_PHOTO_BYTES - image.length)]);
  assert.equal((await post({ bytes: exact })).response.status, 200);
  const over = await post({ bytes: Buffer.concat([exact, Buffer.alloc(1)]) });
  assertFailure(over, 413, 'PAYLOAD_TOO_LARGE');
  assert.equal(over.body.error.message, 'Ukuran foto maksimal 10 MB. Kompres foto lalu coba lagi.');
});

test('an oversized body stops before multipart parsing', async () => {
  let pulled = false;
  const body = new ReadableStream({ pull(controller) { pulled = true; controller.close(); } }, { highWaterMark: 0 });
  const declared = new Request(URL_PHOTO, { method: 'POST', duplex: 'half', headers: { 'content-type': 'multipart/form-data; boundary=x', 'content-length': String(MAX_PHOTO_BYTES * 2) }, body });
  const response = await route.POST(declared);
  assertFailure({ response, body: await response.json() }, 413, 'PAYLOAD_TOO_LARGE');
  assert.equal(pulled, false);
  const streamed = await route.POST(new Request(URL_PHOTO, { method: 'POST', headers: { 'content-type': 'multipart/form-data; boundary=x' }, body: Buffer.alloc(MAX_PHOTO_BYTES * 2) }));
  assertFailure({ response: streamed, body: await streamed.json() }, 413, 'PAYLOAD_TOO_LARGE');
});

test('wrong content types and broken multipart answer in JSON', async () => {
  const json = await route.POST(new Request(URL_PHOTO, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }));
  assertFailure({ response: json, body: await json.json() }, 415, 'UNSUPPORTED_MEDIA_TYPE');
  const bare = await route.POST(new Request(URL_PHOTO, { method: 'POST', body: new Uint8Array([1, 2, 3]) }));
  assertFailure({ response: bare, body: await bare.json() }, 415, 'UNSUPPORTED_MEDIA_TYPE');
  const broken = await route.POST(new Request(URL_PHOTO, { method: 'POST', headers: { 'content-type': 'multipart/form-data; boundary=x' }, body: 'bukan multipart' }));
  assertFailure({ response: broken, body: await broken.json() }, 400, 'INVALID_INPUT');
  const noBoundary = await route.POST(new Request(URL_PHOTO, { method: 'POST', headers: { 'content-type': 'multipart/form-data' }, body: 'x' }));
  assertFailure({ response: noBoundary, body: await noBoundary.json() }, 400, 'INVALID_INPUT');
});

test('a damaged image with valid magic bytes is a 400, not a crash', async (t) => {
  useGemini(t, areas([]));
  const jpeg = await makeImage('jpeg', { width: 400, height: 300 });
  const failures = [
    Buffer.concat([jpeg.subarray(0, 3), Buffer.from('rusak total')]),
    jpeg.subarray(0, Math.floor(jpeg.length / 2)),
    Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.from('rusak')]),
    Buffer.from('RIFF\x10\x00\x00\x00WEBPrusak'),
  ];
  for (const bytes of failures) assertFailure(await post({ bytes }), 400, 'INVALID_INPUT');
});

test('without a key the audit says so, and never invents a result', async () => {
  assertFailure(await post({ bytes: await makeImage() }), 503, 'UPSTREAM_UNAVAILABLE');
});

test('a bad upload is reported as such even without a key', async () => {
  assertFailure(await post({ bytes: Buffer.from('bukan gambar') }), 415, 'UNSUPPORTED_MEDIA_TYPE');
});

const FAILURES = [
  ['kuota habis', () => { throw Object.assign(new Error('x'), { status: 429 }); }, 429, 'QUOTA_EXHAUSTED'],
  ['batas waktu', () => { throw Object.assign(new Error('x'), { name: 'AbortError' }); }, 504, 'AI_TIMEOUT'],
  ['galat server', () => { throw Object.assign(new Error('x'), { status: 500 }); }, 503, 'UPSTREAM_UNAVAILABLE'],
  ['jaringan putus', () => { throw new TypeError('fetch failed'); }, 503, 'UPSTREAM_UNAVAILABLE'],
  ['bukan JSON', () => ({ text: 'maaf' }), 503, 'UPSTREAM_UNAVAILABLE'],
  ['skema salah', () => ({ text: '{"areas":[{"script":"arab"}]}' }), 503, 'UPSTREAM_UNAVAILABLE'],
  ['kotak tidak lengkap', () => ({ text: JSON.stringify({ areas: [{ ...LATIN, box_2d: [1, 2, 3] }] }) }), 503, 'UPSTREAM_UNAVAILABLE'],
];

for (const [label, generateContent, status, code] of FAILURES) {
  test(`${label} fails honestly with ${status}`, async (t) => {
    useGemini(t, generateContent);
    const failure = await post({ bytes: await makeImage() });
    assertFailure(failure, status, code);
    assert.equal(failure.body.error.retryable, true);
  });
}

for (const method of ['GET', 'HEAD', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
  test(`${method} is refused in JSON`, async () => {
    const response = await route[method](new Request(URL_PHOTO, { method }));
    assert.equal(response.headers.get('allow'), 'POST');
    assertFailure({ response, body: await response.json() }, 405, 'METHOD_NOT_ALLOWED');
  });
}

test('an unexpected exception stays a safe JSON envelope', async (t) => {
  useGemini(t, areas([LATIN]));
  const bytes = await makeImage();
  const broken = t.mock.method(String.prototype, 'normalize', () => { throw new Error('gagal di C:/rahasia/server.ts'); });
  const response = await route.POST(formRequest({ bytes }));
  broken.mock.restore();
  const text = await response.text();
  assertFailure({ response, body: JSON.parse(text) }, 500, 'INTERNAL_ERROR');
  assert.doesNotMatch(text, /rahasia|server\.ts/);
});

test('one audit costs three units of the rate limit', async () => {
  const bytes = await makeImage();
  for (let index = 0; index < 10; index += 1) assert.equal((await post({ bytes })).response.status, 503, `audit ${index + 1}`);
  const blocked = await post({ bytes });
  assertFailure(blocked, 429, 'RATE_LIMITED');
  assert.ok(Number(blocked.response.headers.get('retry-after')) > 0);
});

test('the Gemini request is structured, timed, and keeps photo text as data', async (t) => {
  const sdk = useGemini(t, areas([]));
  await post({ bytes: await makeImage() });
  const [{ model, contents, config }] = sdk.calls;
  assert.equal(model, DEFAULT_GEMINI_MODEL);
  assert.equal(config.responseMimeType, 'application/json');
  assert.deepEqual(config.responseJsonSchema.properties.areas.items.required, ['script', 'text', 'box_2d', 'confidence']);
  assert.equal(config.responseJsonSchema.properties.areas.maxItems, 50);
  assert.ok(config.abortSignal instanceof AbortSignal);
  assert.match(config.systemInstruction, /\[ymin, xmin, ymax, xmax\]/);
  assert.match(config.systemInstruction, /bukan instruksi/);
  assert.equal(Object.hasOwn(config, 'temperature'), false);
  assert.equal(contents[0].parts.length, 2);
  assert.equal(PHOTO_TIMEOUT_MS, 12000);
});

test('box_2d stays free of array bounds, which real Gemini rejects with a 400', async (t) => {
  const sdk = useGemini(t, areas([]));
  await post({ bytes: await makeImage() });
  const { box_2d: box } = sdk.calls[0].config.responseJsonSchema.properties.areas.items.properties;
  assert.deepEqual(box, { type: 'array', items: { type: 'number' } });
});

test('box_2d converts from [ymin, xmin, ymax, xmax] on a 0-1000 scale', () => {
  assert.deepEqual(toNormalizedBox([100, 200, 300, 600]), { x: 0.2, y: 0.1, width: 0.4, height: 0.2 });
  assert.deepEqual(toNormalizedBox([0, 0, 1000, 1000]), { x: 0, y: 0, width: 1, height: 1 });
});

test('box_2d clamps to the image', () => {
  assert.deepEqual(toNormalizedBox([-50, -50, 1200, 1200]), { x: 0, y: 0, width: 1, height: 1 });
  assert.deepEqual(toNormalizedBox([900, 900, 1500, 1500]), { x: 0.9, y: 0.9, width: 0.09999999999999998, height: 0.09999999999999998 });
});

test('boxes with no area are dropped', () => {
  for (const box of [[100, 100, 100, 300], [100, 100, 300, 100], [300, 100, 100, 300], [100, 300, 300, 100], [1100, 100, 1200, 300], [-200, 100, -100, 300]]) {
    assert.equal(toNormalizedBox(box), null, JSON.stringify(box));
  }
});

test('a box touching the image edge stays inside it', () => {
  assert.deepEqual(toNormalizedBox([0, 0, 1000, 1000]), { x: 0, y: 0, width: 1, height: 1 });
  for (const box of [[900, 100, 1000, 300], [100, 900, 300, 1000], [990, 990, 1000, 1000], [0, 998, 1000, 1000], [998, 0, 1000, 1000]]) {
    const result = toNormalizedBox(box);
    assert.ok(result.x + result.width <= 1, JSON.stringify(box));
    assert.ok(result.y + result.height <= 1, JSON.stringify(box));
  }
});

test('edge boxes pass the schema end to end', async (t) => {
  useGemini(t, areas([{ ...LATIN, box_2d: [0, 0, 1000, 1000] }, { ...LATIN, box_2d: [900, 900, 1000, 1000] }, { ...LATIN, box_2d: [-5, -5, 1005, 1005] }]));
  const { response, body } = await post({ bytes: await makeImage() });
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(photoAnalysisSchema.parse(body.data).detections.length, 3);
});

test('boxes under 0.002 of the image are dropped, and exactly 0.002 is kept', () => {
  assert.equal(toNormalizedBox([100, 100, 101, 300]), null);
  assert.equal(toNormalizedBox([100, 100, 300, 101]), null);
  assert.equal(toNormalizedBox([100, 100, 101.9, 300]), null);
  assert.equal(toNormalizedBox([999, 100, 1000, 300]), null, 'a side left too thin by the image edge');
  assert.equal(toNormalizedBox([1200, 100, 1300, 300]), null, 'entirely outside the image');
  assert.deepEqual(toNormalizedBox([100, 100, 102, 300]), { x: 0.1, y: 0.1, width: 0.2, height: 0.002 });
  assert.deepEqual(toNormalizedBox([100, 100, 300, 102]), { x: 0.1, y: 0.1, width: 0.002, height: 0.2 });
});

test('no_detection appears only when no box survives', async (t) => {
  const thin = { ...LATIN, box_2d: [100, 100, 101, 900] };
  useGemini(t, areas([thin, LATIN]));
  const kept = (await post({ bytes: await makeImage() })).body.data;
  assert.equal(kept.status, 'detected');
  assert.equal(kept.detections.length, 1);
  useGemini(t, areas([thin]));
  const none = (await post({ bytes: await makeImage() })).body.data;
  assert.equal(none.status, 'no_detection');
  assert.deepEqual(none.detections, []);
});

test('a transparent logo with only Latin text is detected with no Balinese area', async (t) => {
  const lines = [['DOUBLE', [199, 102, 412, 895]], ['COVERAGE', [435, 68, 626, 928]], ['PODCAST', [639, 187, 799, 810]]];
  const sdk = useGemini(t, areas(lines.map(([text, box_2d]) => ({ script: 'latin', text, box_2d, confidence: 'high' }))));
  const mark = await sharp({ create: { width: 900, height: 500, channels: 4, background: { r: 20, g: 20, b: 30, alpha: 1 } } }).png().toBuffer();
  const bytes = await sharp({ create: { width: 1646, height: 956, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite([{ input: mark, left: 370, top: 220 }]).png().toBuffer();
  const { response, body } = await post({ bytes, type: 'image/png', name: 'logo.png' });
  assert.equal(response.status, 200, JSON.stringify(body));
  const data = photoAnalysisSchema.parse(body.data);
  assert.equal(data.status, 'detected');
  assert.deepEqual(data.image, { width: 1646, height: 956 });
  assert.deepEqual(data.detections.map((item) => [item.id, item.text]), [['latin-1', 'DOUBLE'], ['latin-2', 'COVERAGE'], ['latin-3', 'PODCAST']]);
  const summary = getAuditSummary(data);
  assert.deepEqual([summary.latinCount, summary.balineseCount, summary.ratio, summary.position], [3, 0, null, 'unavailable']);
  const { data: pixels } = await sharp(sentImage(sdk)).raw().toBuffer({ resolveWithObject: true });
  assert.ok(pixels[0] > 240 && pixels[1] > 240 && pixels[2] > 240, 'the transparent corner must reach the model as white');
});

test('a quota failure can be traced by requestId and names the quota', async (t) => {
  const quotaError = '{"error":{"code":429,"details":[{"violations":[{"quotaId":"GenerateRequestsPerDayPerProjectPerModel-FreeTier"}]}]}}';
  useGemini(t, () => { throw Object.assign(new Error(quotaError), { status: 429 }); });
  const log = console.error;
  const { body } = await post({ bytes: await makeImage(), name: 'ktp-rahasia.jpg' });
  assert.equal(body.error.code, 'QUOTA_EXHAUSTED');
  const logged = log.mock.calls.flatMap((call) => call.arguments.map(String)).join(' ');
  assert.ok(logged.includes(body.requestId));
  assert.match(logged, /QUOTA_EXHAUSTED/);
  assert.match(logged, /GenerateRequestsPerDayPerProjectPerModel-FreeTier/);
  assert.doesNotMatch(logged, /rahasia/);
});

test('every integer edge stays inside the image', () => {
  for (let min = 0; min <= 998; min += 1) {
    for (const max of [min + 2, 999, 1000]) {
      if (max - min < 2) continue;
      const box = toNormalizedBox([min, min, max, max]);
      assert.ok(box.x + box.width <= 1, `${min}-${max}`);
      assert.ok(box.y + box.height <= 1, `${min}-${max}`);
      assert.ok(box.width > 0 && box.height > 0);
    }
  }
});

test('ids are unique per script and skip dropped boxes', async (t) => {
  const flat = { ...LATIN, box_2d: [10, 10, 10, 90] };
  useGemini(t, areas([LATIN, flat, BALI, LATIN, BALI]));
  const { body } = await post({ bytes: await makeImage() });
  assert.deepEqual(body.data.detections.map((item) => item.id), ['latin-1', 'bali-1', 'latin-2', 'bali-2']);
});

test('only the first 50 areas are kept', async (t) => {
  useGemini(t, areas(Array.from({ length: 60 }, () => LATIN)));
  const { body } = await post({ bytes: await makeImage() });
  assert.equal(body.data.detections.length, 50);
});

test('all boxes dropped counts as no detection', async (t) => {
  useGemini(t, areas([{ ...LATIN, box_2d: [10, 10, 10, 90] }]));
  const { body } = await post({ bytes: await makeImage() });
  assert.equal(body.data.status, 'no_detection');
  assert.deepEqual(body.data.detections, []);
});

test('an empty answer is no detection', async (t) => {
  useGemini(t, areas([]));
  const { body } = await post({ bytes: await makeImage() });
  assert.equal(body.data.status, 'no_detection');
});

test('only an uncertain Balinese area makes the whole result uncertain', async (t) => {
  useGemini(t, areas([{ ...LATIN, confidence: 'low' }, BALI]));
  const latinOnly = (await post({ bytes: await makeImage() })).body.data;
  assert.equal(latinOnly.status, 'detected');
  assert.deepEqual(latinOnly.detections.map((item) => item.uncertain), [true, false]);
  useGemini(t, areas([LATIN, { ...BALI, confidence: 'medium' }]));
  const bali = (await post({ bytes: await makeImage() })).body.data;
  assert.equal(bali.status, 'uncertain');
  assert.equal(bali.detections[1].text, '');
});

const BALINESE_BLOCK = new RegExp(`[${String.fromCodePoint(0x1B00)}-${String.fromCodePoint(0x1B7F)}]`, 'u');

test('a Balinese reading from Gemini never reaches the response, at any confidence', async (t) => {
  for (const text of [BALI.text, 'warung', '', '   ']) {
    for (const confidence of ['high', 'medium', 'low']) {
      useGemini(t, areas([LATIN, { ...BALI, text, confidence }]));
      rateLimiter.reset();
      const { body } = await post({ bytes: await makeImage() });
      const detection = body.data.detections.find((item) => item.script === 'balinese');
      assert.equal(detection.text, '', JSON.stringify(text));
      assert.equal(detection.uncertain, confidence !== 'high');
      assert.doesNotMatch(JSON.stringify(body), BALINESE_BLOCK);
    }
  }
});

test('a hidden reading leaves the area, ratio, and position usable', async (t) => {
  useGemini(t, areas([BALI, LATIN]));
  const data = photoAnalysisSchema.parse((await post({ bytes: await makeImage() })).body.data);
  assert.equal(data.status, 'detected');
  assert.deepEqual(data.detections[0].box, { x: 0.2, y: 0.2, width: 0.6, height: 0.25 });
  const summary = getAuditSummary(data);
  assert.equal(summary.position, 'bali_above');
  assert.ok(summary.ratio > 1);
});

test('Latin text is still reported as read', async (t) => {
  useGemini(t, areas([LATIN]));
  assert.equal((await post({ bytes: await makeImage() })).body.data.detections[0].text, 'WARUNG SARI');
});

test('the model is told not to read Balinese', async (t) => {
  const sdk = useGemini(t, areas([]));
  await post({ bytes: await makeImage() });
  assert.match(sdk.calls[0].config.systemInstruction, /Untuk aksara Bali selalu kosongkan/);
});

test('detected text is flattened and bounded', async (t) => {
  useGemini(t, areas([{ ...LATIN, text: '  WARUNG\n\n  SARI\u0007 ' }, { ...LATIN, text: 'x'.repeat(500) }]));
  const { detections } = (await post({ bytes: await makeImage() })).body.data;
  assert.equal(detections[0].text, 'WARUNG SARI');
  assert.equal(detections[1].text.length, 200);
});

test('nothing about the file reaches the logs', async (t) => {
  useGemini(t, () => { throw Object.assign(new Error('x'), { status: 500 }); });
  const log = console.error;
  await post({ bytes: await makeImage(), name: 'ktp-rahasia-pelanggan.jpg' });
  await post({ bytes: Buffer.from('bukan gambar'), name: 'ktp-rahasia-pelanggan.jpg' });
  const logged = log.mock.calls.flatMap((call) => call.arguments.map(String)).join(' ');
  assert.doesNotMatch(logged, /rahasia|ktp/);
});

function photoFetch(t) {
  t.mock.method(globalThis, 'fetch', async (url, options) => route.POST(new Request(new URL(url, 'http://nyurat.test'), options)));
}

test('contract: the frontend client accepts the route result', async (t) => {
  useGemini(t, areas([BALI, LATIN]));
  photoFetch(t);
  const file = new File([await makeImage('jpeg', { orientation: 6 })], 'papan.jpg', { type: 'image/jpeg' });
  const result = await requestPhotoAudit(file, 3, new AbortController().signal);
  assert.equal(result.photoRevision, 3);
  assert.deepEqual(result.image, { width: 100, height: 200 });
  const summary = getAuditSummary(result);
  assert.equal(summary.position, 'bali_above');
  assert.equal(summary.latinCount, 1);
  assert.ok(summary.ratio > 1);
});

test('contract: the shipped sample photo passes inspection', async (t) => {
  useGemini(t, areas([]));
  photoFetch(t);
  const bytes = readFileSync('tests/fixtures/papan-warung-sari-contoh.png');
  const result = await requestPhotoAudit(new File([bytes], 'papan.png', { type: 'image/png' }), 1, new AbortController().signal);
  const meta = await sharp(bytes).metadata();
  assert.deepEqual(result.image, { width: meta.width, height: meta.height });
});

test('contract: the frontend client reports a route failure', async (t) => {
  useGemini(t, () => { throw Object.assign(new Error('x'), { status: 429 }); });
  photoFetch(t);
  const file = new File([await makeImage()], 'papan.jpg', { type: 'image/jpeg' });
  await assert.rejects(requestPhotoAudit(file, 1, new AbortController().signal), { code: 'AUDIT_UNAVAILABLE' });
});
