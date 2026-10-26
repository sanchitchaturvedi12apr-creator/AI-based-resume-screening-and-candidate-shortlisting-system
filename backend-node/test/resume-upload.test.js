import test from 'node:test'
import assert from 'node:assert/strict'
import bcrypt from 'bcryptjs'
import request from 'supertest'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createApp } from '../src/app.js'

function createPdf(text) {
  const stream = `BT /F1 12 Tf 72 720 Td (${text.replace(/[()\\]/g, '\\$&')}) Tj ET`
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ]
  let document = '%PDF-1.4\n'
  const offsets = [0]
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(document, 'latin1'))
    document += `${index + 1} 0 obj\n${body}\nendobj\n`
  })
  const xrefOffset = Buffer.byteLength(document, 'latin1')
  document += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets.slice(1)) document += `${String(offset).padStart(10, '0')} 00000 n \n`
  document += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`
  return Buffer.from(document, 'latin1')
}

async function setup(t, { maxBytes, existingApplication = false, failResumeInsert = false, failCommit = false } = {}) {
  const storage = await mkdtemp(path.join(tmpdir(), 'resume-upload-'))
  t.after(() => rm(storage, { recursive: true, force: true }))
  const passwordHash = await bcrypt.hash('StrongPassword9!', 4)
  const state = { candidates: new Map(), applications: new Set(), resumes: new Map(), skills: new Map(), nextCandidate: 5, nextResume: 30, nextApplication: 70 }
  if (existingApplication) {
    state.candidates.set('riya@example.com', { id: 5, fullName: 'Riya Shah', email: 'riya@example.com' })
    state.applications.add('5:17')
    await writeFile(path.join(storage, 'existing-resume.pdf'), Buffer.from('previously referenced file'))
  }
  const job = { id: 17, title: 'Frontend Engineer', department: 'Engineering', location: 'Remote', employment_type: 'FULL_TIME', description: 'Build frontend applications with React and Node.js.', min_experience_years: 2, max_experience_years: 8, status: 'ACTIVE' }
  const execute = async (sql, values = []) => {
    if (sql.startsWith('SELECT id FROM recruiter_users')) return [[]]
    if (sql.startsWith('SELECT id, full_name, email, password_hash, role FROM recruiter_users')) return [[{ id: 1, full_name: 'Test Recruiter', email: 'test@example.com', password_hash: passwordHash, role: 'RECRUITER' }]]
    if (sql.startsWith('INSERT INTO recruiter_users')) return [{ insertId: 1 }]
    if (sql === 'SELECT * FROM jobs WHERE id = ?') return [String(values[0]) === '17' ? [job] : []]
    if (sql.startsWith('SELECT skill FROM job_required_skills')) return [[{ skill: 'React' }, { skill: 'Node.js' }]]
    if (sql.startsWith('SELECT skill FROM job_preferred_skills')) return [[{ skill: 'MySQL' }]]
    if (sql.startsWith('SELECT id FROM candidates WHERE email = ?')) {
      const candidate = state.candidates.get(values[0])
      return [candidate ? [{ id: candidate.id }] : []]
    }
    if (sql.startsWith('SELECT id FROM applications WHERE candidate_id = ?')) return [state.applications.has(`${values[0]}:${values[1]}`) ? [{ id: 99 }] : []]
    if (sql.startsWith('SELECT id FROM resumes WHERE storage_key = ?')) return [[...state.resumes.values()].filter((resume) => resume.storageKey === values[0]).map((resume) => ({ id: resume.resumeId }))]
    if (sql.startsWith('INSERT INTO candidates')) {
      const [fullName, email, phone, experienceYears, profileSummary] = values
      let candidate = state.candidates.get(email)
      if (!candidate) { candidate = { id: state.nextCandidate++, fullName, email }; state.candidates.set(email, candidate) }
      candidate.phone = phone; candidate.experienceYears = experienceYears; candidate.profileSummary = profileSummary
      return [{ insertId: candidate.id }]
    }
    if (sql.startsWith('INSERT INTO resumes')) {
      if (failResumeInsert) throw new Error('simulated database failure')
      const resumeId = state.nextResume++
      state.resumes.set(resumeId, { resumeId, candidateId: values[0], originalFilename: values[1], storageKey: values[2], contentType: values[3], sizeBytes: values[4], processingStatus: values[6], processingError: null, createdAt: new Date() })
      return [{ insertId: resumeId }]
    }
    if (sql.startsWith('INSERT INTO applications')) {
      const applicationId = state.nextApplication++
      state.applications.add(`${values[0]}:${values[1]}`)
      return [{ insertId: applicationId }]
    }
    if (sql.startsWith('UPDATE applications SET match_score')) return [{ affectedRows: 1 }]
    if (sql.startsWith('SELECT id AS resumeId, processing_status AS status')) {
      const resume = state.resumes.get(Number(values[0]))
      return [resume ? [{ resumeId: resume.resumeId, status: resume.processingStatus, error: null, updatedAt: resume.createdAt }] : []]
    }
    if (sql.startsWith('SELECT r.id AS resumeId')) {
      const resume = state.resumes.get(Number(values[0]))
      if (!resume) return [[]]
      const candidate = [...state.candidates.values()].find((entry) => entry.id === resume.candidateId)
      return [[{ ...resume, fullName: candidate.fullName, email: candidate.email, phone: candidate.phone, experienceYears: candidate.experienceYears }]]
    }
    if (sql.startsWith('SELECT skill FROM resume_skills')) return [[...(state.skills.get(Number(values[0])) || [])].map((skill) => ({ skill }))]
    if (sql.startsWith('SELECT id, job_id AS jobId, review_status AS status')) return [[]]
    return [[]]
  }
  const pool = {
    execute,
    query: async () => [[{ ok: 1 }]],
    async getConnection() {
      return {
        execute,
        async query(sql, params) {
          const tuples = params[0]
          state.skills.set(Number(tuples[0][0]), tuples.map((tuple) => tuple[2]))
          return [{ affectedRows: tuples.length }]
        },
        async beginTransaction() {},
        async commit() { if (failCommit) throw new Error('simulated uncertain commit') },
        async rollback() {},
        release() {},
      }
    },
  }
  const env = { SESSION_SECRET: 'test-secret-with-at-least-32-chars', SESSION_COOKIE_NAME: 'RESUMESESSION', SESSION_COOKIE_SAME_SITE: 'lax', RESUME_STORAGE_DIR: storage }
  if (maxBytes !== undefined) env.RESUME_MAX_FILE_SIZE_BYTES = String(maxBytes)
  const agent = request.agent(createApp({ pool, env }))
  const csrf = (await agent.get('/api/auth/csrf')).body.token
  await agent.post('/api/auth/register').set('X-XSRF-TOKEN', csrf).send({ fullName: 'Test Recruiter', email: 'test@example.com', password: 'StrongPassword9!', confirmPassword: 'StrongPassword9!' })
  const loginToken = (await agent.get('/api/auth/csrf')).body.token
  await agent.post('/api/auth/login').set('X-XSRF-TOKEN', loginToken).send({ email: 'test@example.com', password: 'StrongPassword9!' })
  return { agent, storage, state }
}

async function docxFixture(name = 'single-paragraph.docx') {
  return readFile(new URL(`../node_modules/mammoth/test/test-data/${name}`, import.meta.url))
}

async function upload(agent, route, buffer, filename, contentType) {
  const csrf = (await agent.get('/api/auth/csrf')).body.token
  return agent.post(route).set('X-XSRF-TOKEN', csrf).attach('file', buffer, { filename, contentType })
}

test('uploads a valid PDF, persists candidate/resume/application data, and serves details/status', async (t) => {
  const { agent, storage, state } = await setup(t)
  const response = await upload(agent, '/api/resumes/upload?jobId=17', createPdf('Riya Shah\nriya@example.com\n+1 415 555 0182\n4 years experience\nReact and Node.js'), '../../resume.pdf', 'application/pdf')
  assert.equal(response.status, 201)
  assert.equal(response.body.processingStatus, 'PROCESSED')
  assert.equal(response.body.candidate.fullName, 'Riya Shah')
  assert.deepEqual(response.body.candidate.skills, ['React', 'Node.js'])
  assert.equal(response.body.application.jobId, 17)
  assert.equal(response.body.originalFilename, 'resume.pdf')
  assert.equal(state.resumes.size, 1)
  const writtenFiles = await readdir(storage)
  assert.equal(writtenFiles.length, 1)
  assert.match(writtenFiles[0], /^[0-9a-f-]+\.pdf$/i)
  assert.equal((await agent.get(`/api/resumes/${response.body.resumeId}/status`)).body.status, 'PROCESSED')
  const details = await agent.get(`/api/resumes/${response.body.resumeId}`)
  assert.deepEqual(details.body.candidate.skills, ['React', 'Node.js'])
  assert.equal(JSON.stringify(details.body).includes(storage), false)
})

test('uploads a valid DOCX and stores extracted text and skills', async (t) => {
  const { agent, state } = await setup(t)
  const response = await upload(agent, '/api/resumes/upload?jobId=17', await docxFixture(), 'resume.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
  assert.equal(response.status, 201)
  assert.equal(state.resumes.size, 1)
  assert.ok([...state.candidates.values()][0].profileSummary.length > 0)
})

test('rejects invalid formats and configured oversized files', async (t) => {
  const invalid = await setup(t)
  const badType = await upload(invalid.agent, '/api/resumes/upload?jobId=17', Buffer.from('plain text'), 'resume.pdf', 'application/pdf')
  assert.equal(badType.status, 415)
  assert.equal((await readdir(invalid.storage)).length, 0)

  const oversized = await setup(t, { maxBytes: 100 })
  const tooBig = await upload(oversized.agent, '/api/resumes/upload?jobId=17', createPdf('This is a valid resume PDF with text'), 'resume.pdf', 'application/pdf')
  assert.equal(tooBig.status, 413)
  assert.equal((await readdir(oversized.storage).catch(() => [])).length, 0)
})

test('returns an OCR explanation for scanned PDFs and rejects unreadable or empty DOCX files', async (t) => {
  const scanned = await setup(t)
  const scannedResponse = await upload(scanned.agent, '/api/resumes/upload?jobId=17', createPdf(''), 'scanned.pdf', 'application/pdf')
  assert.equal(scannedResponse.status, 422)
  assert.equal(scannedResponse.body.code, 'SCANNED_PDF')
  assert.match(scannedResponse.body.message, /OCR is not implemented/)
  assert.equal((await readdir(scanned.storage)).length, 0)

  const unreadable = await setup(t)
  const unreadableResponse = await upload(unreadable.agent, '/api/resumes/upload?jobId=17', Buffer.from('%PDF-not-readable'), 'broken.pdf', 'application/pdf')
  assert.equal(unreadableResponse.status, 422)
  assert.equal(unreadableResponse.body.code, 'UNREADABLE_DOCUMENT')

  const emptyDocx = await setup(t)
  const emptyResponse = await upload(emptyDocx.agent, '/api/resumes/upload?jobId=17', await docxFixture('empty.docx'), 'empty.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
  assert.equal(emptyResponse.status, 422)
  assert.ok(['EMPTY_DOCUMENT', 'UNREADABLE_DOCUMENT'].includes(emptyResponse.body.code))
  assert.equal((await readdir(emptyDocx.storage)).length, 0)
})

test('does not write files for missing jobs, and cleans new uploads on duplicate or database failure', async (t) => {
  const missingJob = await setup(t)
  const notFound = await upload(missingJob.agent, '/api/resumes/upload?jobId=999', createPdf('Riya Shah\nriya@example.com\nReact'), 'resume.pdf', 'application/pdf')
  assert.equal(notFound.status, 404)
  assert.equal((await readdir(missingJob.storage).catch(() => [])).length, 0)

  const duplicate = await setup(t, { existingApplication: true })
  const duplicateResult = await upload(duplicate.agent, '/api/resumes/upload?jobId=17', createPdf('Riya Shah\nriya@example.com\nReact and Node.js'), 'resume.pdf', 'application/pdf')
  assert.equal(duplicateResult.status, 409)
  assert.equal(duplicateResult.body.code, 'DUPLICATE_APPLICATION')
  assert.deepEqual(await readdir(duplicate.storage), ['existing-resume.pdf'])
  assert.equal((await readFile(path.join(duplicate.storage, 'existing-resume.pdf'))).toString(), 'previously referenced file')

  const databaseFailure = await setup(t, { failResumeInsert: true })
  const failedPersistence = await upload(databaseFailure.agent, '/api/resumes/upload?jobId=17', createPdf('Riya Shah\nriya@example.com\nReact and Node.js'), 'resume.pdf', 'application/pdf')
  assert.equal(failedPersistence.status, 500)
  assert.equal((await readdir(databaseFailure.storage)).length, 0)

  const uncertainCommit = await setup(t, { failCommit: true })
  const commitFailure = await upload(uncertainCommit.agent, '/api/resumes/upload?jobId=17', createPdf('Riya Shah\nriya@example.com\nReact and Node.js'), 'resume.pdf', 'application/pdf')
  assert.equal(commitFailure.status, 500)
  assert.equal((await readdir(uncertainCommit.storage)).length, 1)
})
