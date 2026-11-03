# Troubleshooting

| Symptom | Cause and fix |
|---|---|
| Site shows "Live events couldn't be loaded" | The backend isn't running or isn't on port 4000. Start it (`cd backend && npm run dev`). The event archive still works without it |
| Login says "Could not reach the server" | Same as above. In development the site calls `/api`, which Vite forwards to `http://localhost:4000` |
| Logged in, but refreshing logs you out | The cookie isn't reaching the API. In development, open the site at `http://localhost:5173` (not `127.0.0.1`) and keep using the Vite proxy (leave `VITE_API_URL` empty). In production the site and API must be on the same site, or the cookie needs `sameSite: 'none'` plus CSRF protection |
| Google sign-in answers "not configured on this server" | `FIREBASE_PROJECT_ID` is missing from `backend/.env` |
| "Sign in with Google" is greyed out | The Firebase web config is missing from `frontend/.env.local` (see `frontend/.env.example`). Sign in locally with `cd backend && npm run login-link -- <email>` instead |
| "Google sign-in did not complete" | The site's domain isn't in Firebase → Authentication → Settings → Authorized domains |
| "Google sign-in failed. Please try again." | The API rejected the Google token. The server log line `[google sign-in rejected] ...` says why; usually `FIREBASE_PROJECT_ID` differs from the frontend's `VITE_FIREBASE_PROJECT_ID`, or was pasted with quotes on Render |
| Google refuses to sign in ("disallowed_useragent") | The page is open inside an app like Instagram. Open it in Chrome or Safari; the sign-in page says so too |
| Locked out (Google down, wrong Firebase settings) | On the server (Render → Shell) run `npm run login-link -- your@gmail.com` and open the link within 10 minutes |
| Every page sends me to /welcome | The account is missing phone, roll number, branch or year. Fill them in once |
| "Too many requests" | Google sign-in and login links share 10 per 15 minutes per IP. Wait, or restart the backend in development. In production check `TRUST_PROXY` (2 behind Vercel) || Seat bars missing | `GET /api/events/availability` failed; the rest of the event still shows |
| Photos missing on an event | The image must be imported in `src/data/events.js` and exist in `src/assets/events/`. Run `npm run check:data` |
| `npm audit` warnings | Mostly dev tooling. Check with `npm audit --omit=dev`. Avoid `--force` |
