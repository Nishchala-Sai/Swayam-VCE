// Sessions. Signing in is Google-only (google.controller.js), plus emergency login links an operator prints from the
// server (loginLink.controller.js). Both end in setAuthCookie.
import jwt from 'jsonwebtoken'

export const publicUser = ({ id, email, role, isActive, createdAt }) => ({ id, email, role, isActive, createdAt })

// clearCookie must use the same options as res.cookie, or the browser keeps the cookie
const cookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  path: '/',
})

export function setAuthCookie(res, userId) {
  const token = jwt.sign({ sub: userId }, process.env.JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  })
  const { exp } = jwt.decode(token) // cookie expires exactly when the token does
  res.cookie('token', token, { ...cookieOptions(), expires: new Date(exp * 1000) })
}

export function logout(req, res) {
  res.clearCookie('token', cookieOptions())
  res.json({ success: true, data: null })
}

export function me(req, res) {
  res.json({ success: true, data: req.user })
}
