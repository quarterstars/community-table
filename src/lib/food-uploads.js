const multer = require('multer');
const sharp = require('sharp');
const path = require('node:path');
const fs = require('node:fs/promises');
const { randomUUID } = require('node:crypto');
const { HttpError } = require('./errors');

const defaultUploadDirectory = path.join(__dirname, '../../var/uploads/food-photos');
const maxPhotoBytes = 5 * 1024 * 1024;
const parser = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: maxPhotoBytes, files: 1, fields: 40, parts: 41, fieldSize: 12000 }
}).single('foodPhoto');

function parseFoodPhoto(req, res, next) {
  parser(req, res, error => {
    if (!error) return next();
    next(new HttpError(error.code === 'LIMIT_FILE_SIZE' ? 413 : 422,
      error.code === 'LIMIT_FILE_SIZE' ? 'Food photos must be 5 MB or smaller.' : 'Upload one food photo and keep form fields within their limits.'));
  });
}

async function saveFoodPhoto(file, directory = defaultUploadDirectory) {
  if (!file) return null;
  let full, thumbnail;
  try {
    if (!file.buffer.length || file.buffer.length > maxPhotoBytes) throw new Error('size');
    const image = sharp(file.buffer, { limitInputPixels: 20000000, failOn: 'warning' });
    const metadata = await image.metadata();
    // Trust the decoder, never the supplied MIME type or extension. Re-encoding
    // strips original metadata and prevents serving scripts or source bytes.
    if (!['jpeg', 'png', 'webp'].includes(metadata.format) || (metadata.pages || 1) !== 1) throw new Error('format');
    full = await image.rotate().resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
    thumbnail = await sharp(full).resize(176, 176, { fit: 'cover' }).webp({ quality: 80 }).toBuffer();
  } catch {
    throw new HttpError(422, 'Choose a valid JPEG, PNG or WebP photo up to 5 MB and 20 megapixels.');
  }
  const name = randomUUID();
  const files = [path.join(directory, `${name}.webp`), path.join(directory, `${name}-thumb.webp`)];
  const discard = () => Promise.all(files.map(file => fs.unlink(file).catch(() => {})));
  try {
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(files[0], full, { flag: 'wx', mode: 0o600 });
    await fs.writeFile(files[1], thumbnail, { flag: 'wx', mode: 0o600 });
  } catch (error) { await discard(); throw error; }
  return { fields: { image: `/uploads/food-photos/${name}.webp`, imageType: 'photo', imageAlt: 'Shared food photo' }, discard };
}

module.exports = { parseFoodPhoto, saveFoodPhoto, defaultUploadDirectory, maxPhotoBytes };
