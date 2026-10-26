import 'dotenv/config'
import { createPool } from './db.js'
import { createApp, createMySqlSessionStore } from './app.js'
import { initializeApplicationSchema } from './schema.js'

const required = ['DB_USER', 'DB_PASSWORD', 'SESSION_SECRET']
const missing = required.filter((key) => !process.env[key])
if (missing.length) throw new Error(`Missing required environment variables: ${missing.join(', ')}`)
if (process.env.SESSION_SECRET.length < 32) throw new Error('SESSION_SECRET must contain at least 32 characters.')

const pool = createPool()
await initializeApplicationSchema(pool)
const store = createMySqlSessionStore(pool)
await store.ready
const app = createApp({ pool, sessionStore: store })
const port = Number(process.env.PORT || 8080)
const server = app.listen(port, () => console.log(`Resume screening API listening on port ${port}`))

async function shutdown() {
  server.close(async () => {
    await store.close()
    await pool.end()
    process.exit(0)
  })
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
