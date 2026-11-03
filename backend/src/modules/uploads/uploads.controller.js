// Images uploaded by staff when creating an event: the UPI QR code and the event banner. The file is kept in memory and
// checked to really be a PNG, JPEG or WebP by its first bytes (the browser's claimed type is not trusted), then stored
// under a random name:
//   CLOUDINARY_URL set (production): uploaded to Cloudinary, folder swayam/<kind>; the event stores the https URL.
//   Not set (local development): saved in UPLOAD_DIR/<kind> (default backend/uploads) and served at /api/uploads/... by app.js.
import fs from 'node:fs/promises'
import path from 'node:path'
import multer from 'multer'
import { v2 as cloudinary } from 'cloudinary'
import { eq } from 'drizzle-orm'
import { db } from '../../db/index.js'
import { events } from '../../db/schema.js'

export const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || path.join(import.meta.dirname, '../../../uploads'))
const MB = 1024 * 1024

// Each kind has its own folder (locally and on Cloudinary) and the events column that points at it
const KINDS = {
  'upi-qr': { column: events.upiQrUrl, maxBytes: 2 * MB, what: 'The QR code', missing: 'Choose an image of the UPI QR code to upload.' },
  banner: { column: events.bannerUrl, maxBytes: 5 * MB, what: 'The banner', missing: 'Choose a banner image to upload.' },
}

const fail = (res, status, message) => res.status(status).json({ success: false, message })
const useCloudinary = () => Boolean(process.env.CLOUDINARY_URL)
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'

// What upiQrUrl or bannerUrl looks like when it points at a local upload of that kind
export const isUploaded = (kind, value) =>
  typeof value === 'string' && new RegExp(`^/api/uploads/${kind}/${UUID}\\.(png|jpg|webp)$`).test(value)

// The Cloudinary public id (swayam/<kind>/<uuid>) of one of our uploads, or null for any other URL
function cloudinaryId(kind, value) {
  const match = typeof value === 'string' && value.match(new RegExp(`^https://res\\.cloudinary\\.com/[^/]+/image/upload/(?:v\\d+/)?(swayam/${kind}/[0-9a-f-]{36})\\.\\w+$`))
  return match ? match[1] : null
}

// Deletes an uploaded image once no event uses it any more. Other links and missing files are ignored, and a
// failure only logs: a stray image must never stop an event being deleted or edited.
export async function removeUploaded(kind, value) {
  const publicId = cloudinaryId(kind, value)
  if (!isUploaded(kind, value) && !publicId) return
  const [stillUsed] = await db.select({ id: events.id }).from(events).where(eq(KINDS[kind].column, value)).limit(1)
  if (stillUsed) return
  try {
    if (publicId) await cloudinary.uploader.destroy(publicId, { resource_type: 'image' })
    else await fs.rm(path.join(UPLOAD_DIR, kind, path.basename(value)), { force: true })
  } catch (err) {
    console.error('[uploads] could not delete', value, err?.message ?? err)
  }
}

function imageType(buf) {
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png'
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg'
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp'
  return null
}

// Cloudinary reads CLOUDINARY_URL (cloudinary://key:secret@cloud) from the environment
function uploadToCloudinary(buffer, publicId) {
  return new Promise((resolve, reject) => {
    cloudinary.config({ secure: true })
    const stream = cloudinary.uploader.upload_stream(
      // The folder is part of the public id, which works the same with fixed and dynamic folder accounts
      { public_id: publicId, resource_type: 'image', overwrite: false },
      (err, result) => (err ? reject(err) : resolve(result)),
    )
    stream.end(buffer)
  })
}

// multipart/form-data with one field "file". Returns { path } to send as the event's upiQrUrl or bannerUrl.
function uploadImage(kind) {
  const { maxBytes, what, missing } = KINDS[kind]
  const single = multer({ storage: multer.memoryStorage(), limits: { fileSize: maxBytes, files: 1 } }).single('file')
  return (req, res, next) => {
    single(req, res, async (err) => {
      if (err?.code === 'LIMIT_FILE_SIZE') return fail(res, 400, `The image must be ${maxBytes / MB} MB or smaller.`)
      if (err instanceof multer.MulterError) return fail(res, 400, 'Send one image in a form field named "file".')
      if (err) return next(err)
      if (!req.file) return fail(res, 400, missing)

      const ext = imageType(req.file.buffer)
      if (!ext) return fail(res, 400, `${what} must be a PNG, JPEG or WebP image.`)
      const id = crypto.randomUUID()
      try {
        if (useCloudinary()) {
          const result = await uploadToCloudinary(req.file.buffer, `swayam/${kind}/${id}`)
          return res.status(201).json({ success: true, data: { path: result.secure_url } })
        }
        const name = `${id}.${ext}`
        await fs.mkdir(path.join(UPLOAD_DIR, kind), { recursive: true })
        await fs.writeFile(path.join(UPLOAD_DIR, kind, name), req.file.buffer, { flag: 'wx' })
        res.status(201).json({ success: true, data: { path: `/api/uploads/${kind}/${name}` } })
      } catch (e) {
        if (useCloudinary()) {
          console.error('[uploads] Cloudinary upload failed:', e?.message ?? e)
          return fail(res, 502, 'The image could not be stored. Please try again.')
        }
        next(e)
      }
    })
  }
}

export const uploadUpiQr = uploadImage('upi-qr')
export const uploadBanner = uploadImage('banner')
