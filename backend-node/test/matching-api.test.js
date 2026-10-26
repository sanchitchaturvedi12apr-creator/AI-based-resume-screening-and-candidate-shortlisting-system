import test from 'node:test'
import assert from 'node:assert/strict'
import request from 'supertest'
import { createApp } from '../src/app.js'

test('POST match persists a versioned snapshot and GET shortlist returns it separately from review status', async () => {
  let recruiter
  let snapshot
  let reviewStatus = 'REVIEWING'
  const job = { id: 17, title: 'Engineer', department: 'Engineering', location: 'Remote', employment_type: 'FULL_TIME', description: 'Build JavaScript services with Node.js.', min_experience_years: 2, max_experience_years: 8, status: 'ACTIVE' }
  const pool = {
    async query() { return [[]] },
    async execute(sql, values = []) {
      if (sql.startsWith('SELECT id FROM recruiter_users')) return [recruiter ? [{ id: 1 }] : []]
      if (sql.startsWith('INSERT INTO recruiter_users')) { recruiter = { id: 1, full_name: values[0], email: values[1], password_hash: values[2], role: values[3] }; return [{ insertId: 1 }] }
      if (sql.startsWith('SELECT id, full_name, email, password_hash, role FROM recruiter_users')) return [recruiter ? [recruiter] : []]
      if (sql === 'SELECT * FROM jobs WHERE id = ?') return [String(values[0]) === '17' ? [job] : []]
      if (sql.startsWith('SELECT skill FROM job_required_skills')) return [[{ skill: 'JavaScript' }, { skill: 'Node.js' }]]
      if (sql.startsWith('SELECT skill FROM job_preferred_skills')) return [[]]
      if (sql.includes('LEFT JOIN resumes r ON r.id=a.resume_id')) return [[{ applicationId: 91, reviewStatus, candidateId: 4, fullName: 'Riya Shah', email: 'riya@example.com', phone: null, location: null, experienceYears: 2, profileSummary: '', resumeId: 10, extractedText: 'Build JavaScript services with Node.js' }]]
      if (sql.includes('COUNT(*) AS total FROM applications a')) return [[{ total: 1 }]]
      if (sql.includes('LEFT JOIN match_results mr')) return [[{ applicationId: 91, reviewStatus, candidateId: 4, fullName: 'Riya Shah', email: 'riya@example.com', phone: null, location: null, experienceYears: 2, score: snapshot?.score ?? null, algorithmVersion: snapshot?.version ?? null, breakdown: snapshot?.breakdown ?? null, calculatedAt: new Date('2026-01-01T00:00:00Z') }]]
      return [[]]
    },
    async getConnection() {
      return {
        async beginTransaction() {},
        async execute(_sql, values) { snapshot = { applicationId: values[0], version: values[1], score: values[2], breakdown: JSON.parse(values[3]) }; return [{ affectedRows: 1 }] },
        async commit() {}, async rollback() {}, release() {},
      }
    },
  }
  const agent = request.agent(createApp({ pool, env: { SESSION_SECRET: 'test-secret-with-at-least-32-chars', SESSION_COOKIE_NAME: 'RESUMESESSION', SESSION_COOKIE_SAME_SITE: 'lax' } }))
  const csrf = (await agent.get('/api/auth/csrf')).body.token
  await agent.post('/api/auth/register').set('X-XSRF-TOKEN', csrf).send({ fullName: 'Test Recruiter', email: 'test@example.com', password: 'StrongPassword9!', confirmPassword: 'StrongPassword9!' }).expect(201)
  const loginCsrf = (await agent.get('/api/auth/csrf')).body.token
  await agent.post('/api/auth/login').set('X-XSRF-TOKEN', loginCsrf).send({ email: 'test@example.com', password: 'StrongPassword9!' }).expect(200)

  const matchCsrf = (await agent.get('/api/auth/csrf')).body.token
  const calculated = await agent.post('/api/jobs/17/match').set('X-XSRF-TOKEN', matchCsrf).send({}).expect(200)
  assert.equal(calculated.body.algorithmVersion, 'rules-v1')
  assert.equal(calculated.body.calculated, 1)
  assert.equal(snapshot.version, 'rules-v1')
  assert.equal(snapshot.score, 100)

  const shortlist = await agent.get('/api/jobs/17/shortlist?page=0&size=10&status=REVIEWING').expect(200)
  assert.equal(shortlist.body.content[0].score, 100)
  assert.equal(shortlist.body.content[0].reviewStatus, 'REVIEWING')
  assert.equal(shortlist.body.content[0].breakdown.requiredSkills.coverage, 100)
  assert.equal(shortlist.body.decisionSupport, true)
})
