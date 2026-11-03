import { Router } from 'express'
import { requireAuth } from '../../middleware/requireAuth.js'
import { requireRole } from '../../middleware/requireRole.js'
import { uploadBanner, uploadUpiQr } from './uploads.controller.js'

const router = Router()

router.post('/upi-qr', requireAuth, requireRole(['ADMIN', 'EVENT_HEAD']), uploadUpiQr)
router.post('/banner', requireAuth, requireRole(['ADMIN', 'EVENT_HEAD']), uploadBanner)

export default router
