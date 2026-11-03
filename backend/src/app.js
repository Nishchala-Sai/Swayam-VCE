import express from 'express'
import helmet from 'helmet'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import authRoutes from './modules/auth/auth.routes.js'
import eventRoutes from './modules/events/events.routes.js'
import registrationRoutes from './modules/registrations/registrations.routes.js'
import paymentRoutes from './modules/payments/payments.routes.js'
import analyticsRoutes from './modules/analytics/analytics.routes.js'
import venueRoutes from './modules/venues/venues.routes.js'
import uploadRoutes from './modules/uploads/uploads.routes.js'
import { UPLOAD_DIR } from './modules/uploads/uploads.controller.js'

export const app = express()

// Number of proxies in front of the app (0 locally, usually 1 on Render/Railway). Rate limits key on req.ip,
// so a wrong value either puts every student in one bucket (too low) or lets clients fake their IP (too high).
app.set('trust proxy', Number(process.env.TRUST_PROXY) || 0)

app.use(helmet())
// credentials: true is required for the browser to send the `token` cookie cross-origin
app.use(cors({ origin: (process.env.CORS_ORIGIN || 'http://localhost:5173').split(','), credentials: true }))
app.use(express.json({ limit: '100kb' }))
app.use(cookieParser())

app.get('/health', (req, res) => res.json({ success: true, data: { status: 'ok' } }))

app.use('/api/auth', authRoutes)
app.use('/api/events', eventRoutes)
app.use('/api/registrations', registrationRoutes)
app.use('/api/payments', paymentRoutes)
app.use('/api/analytics', analyticsRoutes)
app.use('/api/venues', venueRoutes)
app.use('/api/uploads', uploadRoutes)

// Uploaded files (UPI QR and banner images). Names are random UUIDs and never reused, so they can be cached for good.
// cross-origin: the site may be served from another domain than the API in production.
app.use(
  '/api/uploads',
  express.static(UPLOAD_DIR, {
    index: false,
    dotfiles: 'deny',
    immutable: true,
    maxAge: '365d',
    setHeaders: (res) => res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin'),
  }),
)

app.use((req, res) => res.status(404).json({ success: false, message: 'Not found' }))

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err)
  res.status(err.status || 500).json({ success: false, message: err.expose ? err.message : 'Internal server error' })
})
