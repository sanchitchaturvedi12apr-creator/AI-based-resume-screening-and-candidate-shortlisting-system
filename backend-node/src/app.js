import express from 'express'
import cors from 'cors'
import session from 'express-session'
import { mountAuth, csrfMatches } from './auth.js'
import { mountRoutes } from './routes.js'

const unsafeMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

export function createApp({ pool, sessionStore, env = process.env }) {
  const app = express()
  const origins = (env.FRONTEND_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173').split(',').map((origin) => origin.trim()).filter(Boolean)
  if ((env.SESSION_COOKIE_SAME_SITE || 'lax') === 'none' && env.SESSION_COOKIE_SECURE !== 'true') throw new Error('SESSION_COOKIE_SECURE must be true when SESSION_COOKIE_SAME_SITE is none.')
  app.disable('x-powered-by')
  app.use(cors({ origin(origin, callback) { callback(null, !origin || origins.includes(origin)) }, credentials: true, methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'], allowedHeaders: ['Content-Type', 'X-XSRF-TOKEN'] }))
  app.use(express.json({ limit: '1mb' }))
  app.use(session({
    name: env.SESSION_COOKIE_NAME || 'RESUMESESSION',
    secret: env.SESSION_SECRET || 'development-only-change-me-32-characters',
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, secure: env.SESSION_COOKIE_SECURE === 'true', sameSite: env.SESSION_COOKIE_SAME_SITE || 'lax', maxAge: Number(env.SESSION_MAX_AGE_MS || 1800000), path: '/' },
  }))
  app.use((req, res, next) => {
    if (!unsafeMethods.has(req.method)) return next()
    const expected = req.session?.csrfToken
    if (!csrfMatches(expected, req.get('X-XSRF-TOKEN'))) return res.status(403).json({ code: 'CSRF_INVALID', message: 'Missing or invalid CSRF token.' })
    next()
  })

  app.get('/api/health', async (_req, res) => {
    try { await pool.query('SELECT 1'); res.json({ status: 'UP', database: 'UP' }) }
    catch { res.status(503).json({ status: 'DOWN', database: 'DOWN' }) }
  })
  mountAuth(app, { pool })
  mountRoutes(app, { pool, env })
  app.use((err, _req, res, _next) => {
    console.error('Request failed', { name: err.name, code: err.code })
    if (err.type === 'entity.parse.failed') return res.status(400).json({ code: 'INVALID_JSON', message: 'Request body must contain valid JSON.' })
    if (err.type === 'entity.too.large') return res.status(413).json({ code: 'REQUEST_TOO_LARGE', message: 'Request body is too large.' })
    res.status(500).json({ code: 'INTERNAL_ERROR', message: 'An unexpected server error occurred.' })
  })
  return app
}

export function createMySqlSessionStore(pool, env = process.env) {
  class MySqlSessionStore extends session.Store {
    constructor() {
      super()
      this.ready = pool.execute(`CREATE TABLE IF NOT EXISTS sessions (
        session_id VARCHAR(128) COLLATE utf8mb4_bin NOT NULL,
        expires BIGINT UNSIGNED NOT NULL,
        data MEDIUMTEXT NOT NULL,
        PRIMARY KEY (session_id),
        INDEX idx_sessions_expires (expires)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`)
      this.cleanup = setInterval(() => {
        pool.execute('DELETE FROM sessions WHERE expires <= ?', [Date.now()]).catch((error) => console.error('Session cleanup failed:', error.message))
      }, 900000)
      this.cleanup.unref()
    }

    get(id, callback) {
      pool.execute('SELECT data FROM sessions WHERE session_id = ? AND expires > ?', [id, Date.now()])
        .then(([rows]) => callback(null, rows.length ? JSON.parse(rows[0].data) : null)).catch(callback)
    }

    set(id, value, callback = () => {}) {
      const expires = value.cookie?.expires ? Date.parse(value.cookie.expires) : Date.now() + Number(value.cookie?.maxAge || env.SESSION_MAX_AGE_MS || 1800000)
      pool.execute('INSERT INTO sessions (session_id, expires, data) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE expires=VALUES(expires), data=VALUES(data)', [id, expires, JSON.stringify(value)])
        .then(() => callback(null), callback)
    }

    touch(id, value, callback = () => {}) {
      const expires = value.cookie?.expires ? Date.parse(value.cookie.expires) : Date.now() + Number(value.cookie?.maxAge || env.SESSION_MAX_AGE_MS || 1800000)
      pool.execute('UPDATE sessions SET expires = ? WHERE session_id = ?', [expires, id]).then(() => callback(null), callback)
    }

    destroy(id, callback = () => {}) {
      pool.execute('DELETE FROM sessions WHERE session_id = ?', [id]).then(() => callback(null), callback)
    }

    close() {
      clearInterval(this.cleanup)
      return Promise.resolve()
    }
  }
  return new MySqlSessionStore()
}
