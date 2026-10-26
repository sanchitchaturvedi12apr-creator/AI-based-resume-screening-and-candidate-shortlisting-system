import bcrypt from 'bcryptjs'
import { randomBytes, timingSafeEqual } from 'node:crypto'

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const passwordPattern = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9\s]).{12,72}$/
const publicProfile = ({ id, full_name, email, role }) => ({ id, fullName: full_name, email, role })

export function csrfMatches(expected, provided) {
  if (typeof expected !== 'string' || typeof provided !== 'string') return false
  const left = Buffer.from(expected)
  const right = Buffer.from(provided)
  return left.length === right.length && timingSafeEqual(left, right)
}

export function mountAuth(app, { pool }) {
  app.get('/api/auth/csrf', (req, res) => {
    req.session.csrfToken ||= randomBytes(32).toString('hex')
    res.json({ token: req.session.csrfToken })
  })

  app.post('/api/auth/register', async (req, res, next) => {
    const { fullName, email, password, confirmPassword } = req.body || {}
    const errors = {}
    const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : ''
    if (typeof fullName !== 'string' || fullName.trim().length < 2 || fullName.trim().length > 160) errors.fullName = 'Name must be 2 to 160 characters.'
    if (!emailPattern.test(normalizedEmail) || normalizedEmail.length > 254) errors.email = 'Enter a valid email address.'
    if (typeof password !== 'string' || !passwordPattern.test(password) || Buffer.byteLength(password, 'utf8') > 72) errors.password = 'Password must be 12 to 72 characters (maximum 72 bytes) and include uppercase, lowercase, number, and symbol.'
    if (password !== confirmPassword) errors.confirmPassword = 'Passwords must match.'
    if (Object.keys(errors).length) return res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Please correct the highlighted fields.', fieldErrors: errors })
    try {
      const [existing] = await pool.execute('SELECT id FROM recruiter_users WHERE email = ? LIMIT 1', [normalizedEmail])
      if (existing.length) return res.status(409).json({ code: 'DUPLICATE_EMAIL', message: 'An account with this email already exists.', fieldErrors: { email: 'Email is already registered.' } })
      const hash = await bcrypt.hash(password, 12)
      const [result] = await pool.execute(
        'INSERT INTO recruiter_users (full_name, email, password_hash, role, created_at, updated_at) VALUES (?, ?, ?, ?, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))',
        [fullName.trim(), normalizedEmail, hash, 'RECRUITER'],
      )
      return res.status(201).json({ id: result.insertId, fullName: fullName.trim(), email: normalizedEmail, role: 'RECRUITER' })
    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ code: 'DUPLICATE_EMAIL', message: 'An account with this email already exists.', fieldErrors: { email: 'Email is already registered.' } })
      next(error)
    }
  })

  app.post('/api/auth/login', async (req, res, next) => {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : ''
    const password = req.body?.password
    if (!emailPattern.test(email) || email.length > 254 || typeof password !== 'string' || Buffer.byteLength(password, 'utf8') > 72) {
      return res.status(401).json({ code: 'INVALID_CREDENTIALS', message: 'Email or password is incorrect.' })
    }
    try {
      const [rows] = await pool.execute('SELECT id, full_name, email, password_hash, role FROM recruiter_users WHERE email = ? LIMIT 1', [email])
      if (!rows.length || !(await bcrypt.compare(password, rows[0].password_hash))) {
        return res.status(401).json({ code: 'INVALID_CREDENTIALS', message: 'Email or password is incorrect.' })
      }
      const profile = publicProfile(rows[0])
      req.session.regenerate((error) => {
        if (error) return next(error)
        req.session.user = profile
        req.session.csrfToken = randomBytes(32).toString('hex')
        req.session.save((saveError) => saveError ? next(saveError) : res.json(profile))
      })
    } catch (error) { next(error) }
  })

  app.get('/api/auth/me', (req, res) => {
    if (!req.session.user) return res.status(401).json({ code: 'UNAUTHENTICATED', message: 'Please sign in.' })
    res.json(req.session.user)
  })

  app.post('/api/auth/logout', (req, res, next) => {
    req.session.destroy((error) => {
      if (error) return next(error)
      res.clearCookie(process.env.SESSION_COOKIE_NAME || 'RESUMESESSION', { httpOnly: true, sameSite: process.env.SESSION_COOKIE_SAME_SITE || 'lax', secure: process.env.SESSION_COOKIE_SECURE === 'true', path: '/' })
      res.status(204).end()
    })
  })
}

export function requireAuth(req, res, next) {
  if (!req.session?.user) return res.status(401).json({ code: 'UNAUTHENTICATED', message: 'Please sign in.' })
  next()
}
