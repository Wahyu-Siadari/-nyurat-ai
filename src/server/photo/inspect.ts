import "server-only";
import sharp from "sharp";
import { MAX_PHOTO_BYTES, MAX_PHOTO_PIXELS, validatePhotoDimensions } from "../../lib/photo-audit.ts";
import { ApiError } from "../http/errors.ts";
import { readLimitedBody } from "../http/parse-project.ts";

const MULTIPART_OVERHEAD_BYTES = 64 * 1024;
const MAX_MODEL_EDGE_PX = 1600;
const MODEL_JPEG_QUALITY = 85;
const UNREADABLE_MESSAGE = "Isi gambar tidak dapat dibaca. Pilih foto JPG, PNG, atau WebP yang dapat dibuka.";
const UNSUPPORTED_MESSAGE = "Gunakan gambar JPG, PNG, atau WebP.";

// Photos live only in memory for one request, so libvips must not keep them in its operation cache.
sharp.cache(false);

export type PhotoFormat = "jpeg" | "png" | "webp";
export type PhotoUpload = { bytes: Buffer; photoRevision: number };
export type InspectedPhoto = { format: PhotoFormat; width: number; height: number };

function parseRevision(value: FormDataEntryValue | null): number {
  const revision = typeof value === "string" && /^[1-9]\d*$/.test(value) ? Number(value) : Number.NaN;
  if (!Number.isSafeInteger(revision)) throw new ApiError("INVALID_INPUT", "Revisi foto tidak valid.");
  return revision;
}

export async function parsePhotoRequest(request: Request): Promise<PhotoUpload> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.split(";")[0].trim().toLowerCase() !== "multipart/form-data") throw new ApiError("UNSUPPORTED_MEDIA_TYPE", "Kirim foto sebagai multipart/form-data.");

  // formData() buffers everything it is given, so the size limit has to be enforced before it runs.
  const body = await readLimitedBody(request, MAX_PHOTO_BYTES + MULTIPART_OVERHEAD_BYTES);
  let form: FormData;
  try {
    form = await new Response(body as Uint8Array<ArrayBuffer>, { headers: { "content-type": contentType } }).formData();
  } catch (cause) {
    throw new ApiError("INVALID_INPUT", "Data unggahan tidak dapat dibaca.", { cause });
  }

  const photoRevision = parseRevision(form.get("photoRevision"));
  const photo = form.get("photo");
  if (!(photo instanceof File)) throw new ApiError("INVALID_INPUT", "Pilih foto terlebih dahulu.");
  if (photo.size <= 0) throw new ApiError("INVALID_INPUT", "Berkas gambar kosong atau tidak valid. Pilih foto lain.");
  if (photo.size > MAX_PHOTO_BYTES) throw new ApiError("PAYLOAD_TOO_LARGE", "Ukuran foto maksimal 10 MB. Kompres foto lalu coba lagi.");
  return { bytes: Buffer.from(await photo.arrayBuffer()), photoRevision };
}

export function sniffFormat(bytes: Uint8Array): PhotoFormat | null {
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (bytes[0] === 0x89 && ascii(1, 4) === "PNG") return "png";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "webp";
  return null;
}

// data.image must equal the browser's naturalWidth and naturalHeight, or the frontend rejects the result.
// Chrome 152 (measured) applies EXIF orientation to JPEG and PNG but not to WebP, so a WebP stays as
// stored in both the reported size and the pixels sent to the model. Boxes then match the shown photo.
function appliesOrientation(format: PhotoFormat): boolean {
  return format !== "webp";
}

async function readMetadata(bytes: Buffer) {
  try {
    return await sharp(bytes).metadata();
  } catch (cause) {
    throw new ApiError("INVALID_INPUT", UNREADABLE_MESSAGE, { cause });
  }
}

export async function inspectPhoto(bytes: Buffer): Promise<InspectedPhoto> {
  const format = sniffFormat(bytes);
  if (!format) throw new ApiError("UNSUPPORTED_MEDIA_TYPE", UNSUPPORTED_MESSAGE);

  const metadata = await readMetadata(bytes);
  if (metadata.format !== format) throw new ApiError("UNSUPPORTED_MEDIA_TYPE", UNSUPPORTED_MESSAGE);

  const { width, height } = appliesOrientation(format) ? metadata.autoOrient : metadata;
  const invalid = validatePhotoDimensions(width, height);
  if (invalid) throw new ApiError("INVALID_INPUT", invalid);
  return { format, width, height };
}

// Output carries no metadata, so EXIF such as GPS position never reaches the provider. Resizing does
// not disturb the result, because detected boxes are normalized to the image.
export async function prepareForModel(bytes: Buffer, format: PhotoFormat): Promise<Buffer> {
  try {
    const image = sharp(bytes, { limitInputPixels: MAX_PHOTO_PIXELS, failOn: "error" });
    const oriented = appliesOrientation(format) ? image.rotate() : image;
    return await oriented
      .flatten({ background: "#ffffff" })
      .resize({ width: MAX_MODEL_EDGE_PX, height: MAX_MODEL_EDGE_PX, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: MODEL_JPEG_QUALITY })
      .toBuffer();
  } catch (cause) {
    throw new ApiError("INVALID_INPUT", UNREADABLE_MESSAGE, { cause });
  }
}
