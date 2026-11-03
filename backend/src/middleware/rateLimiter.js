// Counts per client IP in this process's memory: limits reset on restart and are not shared between instances.
// Behind a proxy (Render, Railway, Cloudflare) set TRUST_PROXY so req.ip is the student's IP, not the proxy's.
import { rateLimit } from 'express-rate-limit'

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8', // RateLimit and RateLimit-Policy headers tell the client when to retry
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests, please try again after 15 minutes.' },
})
