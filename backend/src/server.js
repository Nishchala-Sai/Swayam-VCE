import 'dotenv/config' // must stay the first import so env vars exist before other modules read them
import { app } from './app.js'

for (const key of ['DATABASE_URL', 'JWT_SECRET', 'QR_SECRET']) {
  if (!process.env[key]) throw new Error(`${key} is not set (see backend/.env.example)`)
}

const port = Number(process.env.PORT) || 4000
app.listen(port, () => console.log(`Swayam API listening on http://localhost:${port}`))
