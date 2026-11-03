import { Router } from 'express'
import { authLimiter } from '../../middleware/rateLimiter.js'
import { requireAuth } from '../../middleware/requireAuth.js'
import { logout, me } from './auth.controller.js'
import { googleLogin } from './google.controller.js'
import { useLoginLink } from './loginLink.controller.js'
import { updateMe } from './profile.controller.js'

const router = Router()

router.post('/google-login', authLimiter, googleLogin)
router.get('/link', authLimiter, useLoginLink)
router.post('/logout', logout)
router.get('/me', requireAuth, me)
router.patch('/me', requireAuth, updateMe)

export default router
