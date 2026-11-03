import { Router } from 'express'
import { requireAuth } from '../../middleware/requireAuth.js'
import { requireRole } from '../../middleware/requireRole.js'
import { getOverview } from './analytics.controller.js'
import { listStudents } from '../events/registrationsList.controller.js'

const router = Router()

router.get('/overview', requireAuth, requireRole(['ADMIN']), getOverview)
router.get('/students', requireAuth, requireRole(['ADMIN']), listStudents)

export default router
