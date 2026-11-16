import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp, { type Metadata } from 'sharp';

export const AVATAR_MAX_BYTES = 5 * 1024 * 1024;
const ACCEPTED = new Set(['jpeg', 'png', 'webp']);
/** Larger pictures are refused before decoding (a small file can claim a huge size). */
const MAX_PIXELS = 40_000_000;
export const AVATAR_FILE = /^[0-9a-f-]{36}-(256|64)\.webp$/;

/**
 * Stores a profile picture as 256×256 and 64×64 WebP. The type is judged from the content, not the name.
 * Re-encoding drops everything but the pixels: EXIF (location), comments and anything hidden in the file.
 * Returns the new id, or an error code.
 */
export async function saveAvatar(dir: string, data: Buffer): Promise<string | { error: string }> {
  let meta: Metadata;
  try {
    meta = await sharp(data, { limitInputPixels: MAX_PIXELS }).metadata();
  } catch {
    return { error: 'invalid_image' };
  }
  if (!meta.format || !ACCEPTED.has(meta.format)) return { error: 'invalid_image' };
  const id = randomUUID();
  await mkdir(dir, { recursive: true });
  try {
    for (const size of [256, 64]) {
      const out = await sharp(data, { limitInputPixels: MAX_PIXELS, animated: false })
        .rotate() // apply the EXIF orientation before it is dropped
        .resize(size, size, { fit: 'cover' })
        .webp({ quality: 85 })
        .toBuffer();
      await writeFile(join(dir, `${id}-${size}.webp`), out);
    }
  } catch {
    await removeAvatar(dir, id);
    return { error: 'invalid_image' };
  }
  return id;
}

export async function removeAvatar(dir: string, id: string | null) {
  if (!id || !/^[0-9a-f-]{36}$/.test(id)) return;
  await Promise.all([256, 64].map((s) => rm(join(dir, `${id}-${s}.webp`), { force: true })));
}
