import test from 'node:test'
import assert from 'node:assert/strict'
import request from 'supertest'
import bcrypt from 'bcryptjs'
import { createApp } from '../src/app.js'

function setup() {
  const users = []
  const pool = {
    async query() { return [[{ ok: 1 }]] },
    async execute(sql, values) {
      if (sql.startsWith('SELECT id FROM recruiter_users')) return [users.filter((user) => user.email === values[0]).map((user) => ({ id: user.id }))]
      if (sql.startsWith('SELECT id, full_name, email, password_hash, role')) return [users.filter((user) => user.email === values[0])]
      if (sql.startsWith('INSERT INTO recruiter_users')) {
        if (users.some((user) => user.email === values[1])) { const error = new Error('duplicate'); error.code = 'ER_DUP_ENTRY'; throw error }
        const user = { id: users.length + 1, full_name: values[0], email: values[1], password_hash: values[2], role: values[3] }
        users.push(user)
        return [{ insertId: user.id }]
      }
      throw new Error(`Unexpected query: ${sql}`)
    },
  }
  const agent = request.agent(createApp({ pool, env: { SESSION_SECRET: 'test-secret-with-at-least-32-chars', SESSION_COOKIE_NAME: 'RESUMESESSION', SESSION_COOKIE_SAME_SITE: 'lax' } }))
  return { agent, users }
}

async function csrf(agent) {
  const response = await agent.get('/api/auth/csrf')
  return response.body.token
}

test('registration stores a bcrypt hash and does not expose credentials', async () => {
  const { agent, users } = setup()
  const token = await csrf(agent)
  const response = await agent.post('/api/auth/register').set('X-XSRF-TOKEN', token).send({ fullName: 'Riya Recruiter', email: 'RIYA@example.com', password: 'StrongPassword9!', confirmPassword: 'StrongPassword9!' })
  assert.equal(response.status, 201)
  assert.equal(response.body.email, 'riya@example.com')
  assert.equal('password' in response.body, false)
  assert.equal('password_hash' in response.body, false)
  assert.notEqual(users[0].password_hash, 'StrongPassword9!')
  assert.equal(await bcrypt.compare('StrongPassword9!', users[0].password_hash), true)
})

test('registration rejects duplicate emails and weak passwords', async () => {
  const { agent } = setup()
  let token = await csrf(agent)
  const payload = { fullName: 'Riya Recruiter', email: 'riya@example.com', password: 'StrongPassword9!', confirmPassword: 'StrongPassword9!' }
  assert.equal((await agent.post('/api/auth/register').set('X-XSRF-TOKEN', token).send(payload)).status, 201)
  token = await csrf(agent)
  assert.equal((await agent.post('/api/auth/register').set('X-XSRF-TOKEN', token).send(payload)).status, 409)
  token = await csrf(agent)
  assert.equal((await agent.post('/api/auth/register').set('X-XSRF-TOKEN', token).send({ ...payload, email: 'other@example.com', password: 'weak', confirmPassword: 'weak' })).status, 400)
})

test('login protects private routes, keeps a server session, and logout invalidates it', async () => {
  const { agent } = setup()
  const registerToken = await csrf(agent)
  const payload = { fullName: 'Riya Recruiter', email: 'riya@example.com', password: 'StrongPassword9!', confirmPassword: 'StrongPassword9!' }
  await agent.post('/api/auth/register').set('X-XSRF-TOKEN', registerToken).send(payload)
  assert.equal((await agent.get('/api/auth/me')).status, 401)
  let token = await csrf(agent)
  assert.equal((await agent.post('/api/auth/login').set('X-XSRF-TOKEN', token).send({ email: payload.email, password: 'wrong' })).status, 401)
  token = await csrf(agent)
  const login = await agent.post('/api/auth/login').set('X-XSRF-TOKEN', token).send({ email: payload.email, password: payload.password })
  assert.equal(login.status, 200)
  assert.equal(login.body.email, payload.email)
  assert.equal((await agent.get('/api/auth/me')).status, 200)
  assert.match(login.headers['set-cookie'].join(';'), /HttpOnly/i)
  token = await csrf(agent)
  assert.equal((await agent.post('/api/auth/logout').set('X-XSRF-TOKEN', token).send({})).status, 204)
  assert.equal((await agent.get('/api/auth/me')).status, 401)
})

test('state-changing requests require the session CSRF token', async () => {
  const { agent } = setup()
  const response = await agent.post('/api/auth/login').send({ email: 'x@example.com', password: 'x' })
  assert.equal(response.status, 403)
})
