// The site's own address, for links the API hands out (login links). FRONTEND_URL, else the first CORS origin.
export const frontendUrl = () =>
  (process.env.FRONTEND_URL || (process.env.CORS_ORIGIN || 'http://localhost:5173').split(',')[0]).replace(/\/+$/, '')
