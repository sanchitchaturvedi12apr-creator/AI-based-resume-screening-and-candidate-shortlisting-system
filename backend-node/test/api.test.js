import test from 'node:test'
import assert from 'node:assert/strict'
import request from 'supertest'
import bcrypt from 'bcryptjs'
import { createApp } from '../src/app.js'
import { scoreCandidate } from '../src/matching.js'

async function setup() {
  const calls = []
  const hash = await bcrypt.hash('StrongPassword9!', 4)
  const pool = {
    async query() { return [[{ ok: 1 }]] },
    async execute(sql) {
      calls.push(sql)
      if (sql.includes('COUNT(*) AS total FROM jobs')) return [[{ total: 0 }]]
      if (sql.includes('FROM jobs') && sql.includes('ORDER BY created_at DESC')) return [[]]
      if (sql.includes('SELECT * FROM jobs WHERE id')) return [[{ id: 17, title: 'Test Developer', department: 'Engineering', location: 'Remote', employment_type: 'FULL_TIME', description: 'Build reliable web services.', min_experience_years: 1, max_experience_years: 8, status: 'ACTIVE' }]]
      if (sql.includes('SELECT id FROM recruiter_users')) return [[]]
      if (sql.includes('SELECT id, full_name, email, password_hash, role')) return [[{ id: 1, full_name: 'Test Recruiter', email: 'test@example.com', password_hash: hash, role: 'RECRUITER' }]]
      if (sql.includes('INSERT INTO recruiter_users')) return [{ insertId: 1 }]
      return [[]]
    },
  }
  const agent = request.agent(createApp({ pool, env: { SESSION_SECRET: 'test-secret-with-at-least-32-chars', SESSION_COOKIE_NAME: 'RESUMESESSION', SESSION_COOKIE_SAME_SITE: 'lax' } }))
  return { agent, calls }
}

async function token(agent) { return (await agent.get('/api/auth/csrf')).body.token }
async function signIn(agent) {
  let csrf = await token(agent)
  await agent.post('/api/auth/register').set('X-XSRF-TOKEN', csrf).send({ fullName: 'Test Recruiter', email: 'test@example.com', password: 'StrongPassword9!', confirmPassword: 'StrongPassword9!' })
  csrf = await token(agent)
  await agent.post('/api/auth/login').set('X-XSRF-TOKEN', csrf).send({ email: 'test@example.com', password: 'StrongPassword9!' })
}

test('private jobs API requires an authenticated session', async () => {
  const { agent } = await setup()
  assert.equal((await agent.get('/api/jobs')).status, 401)
  await signIn(agent)
  const response = await agent.get('/api/jobs')
  assert.equal(response.status, 200)
  assert.deepEqual(response.body.content, [])
  assert.equal(response.body.totalElements, 0)
})

test('job creation validates fields before database writes', async () => {
  const { agent, calls } = await setup()
  await signIn(agent)
  const csrf = await token(agent)
  const response = await agent.post('/api/jobs').set('X-XSRF-TOKEN', csrf).send({ title: '' })
  assert.equal(response.status, 400)
  assert.equal(response.body.code, 'VALIDATION_ERROR')
  assert.deepEqual(calls.filter((sql) => sql.startsWith('INSERT INTO jobs')), [])
})

test('matching returns the 70/20/10 deterministic breakdown and reports missing experience', () => {
  const result = scoreCandidate(
    { title: 'React Engineer', description: 'Build React systems with Node and SQL.', requiredSkills: ['React', 'Node.js'], preferredSkills: ['MySQL'], min_experience_years: 4 },
    { experience_years: 2, profile_summary: 'React developer with MySQL experience' },
    'React Node.js MySQL',
  )
  assert.equal(result.score, 82)
  assert.deepEqual(result.explanation.requiredSkills.missing, [])
  assert.deepEqual(result.explanation.weights, { requiredSkills: 70, experience: 20, keywords: 10 })
  assert.equal(result.algorithmVersion, 'rules-v1')
  const unknown = scoreCandidate({ requiredSkills: [], preferredSkills: [], min_experience_years: null, description: '', title: '' }, { experience_years: null }, '')
  assert.equal(unknown.explanation.experience.score, null)
  assert.equal(unknown.explanation.experience.candidateYears, null)
})

test('upload rejects unsupported files before touching storage', async () => {
  const { agent } = await setup()
  await signIn(agent)
  const csrf = await token(agent)
  const response = await agent.post('/api/resumes/upload?jobId=17').set('X-XSRF-TOKEN', csrf).attach('file', Buffer.from('plain text'), { filename: 'resume.txt', contentType: 'text/plain' })
  assert.equal(response.status, 415)
  assert.equal(response.body.code, 'UNSUPPORTED_FILE')
})
