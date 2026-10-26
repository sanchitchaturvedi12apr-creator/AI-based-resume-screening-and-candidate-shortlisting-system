import express from 'express'
import multer from 'multer'
import { createHash, randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { mkdir, writeFile, unlink } from 'node:fs/promises'
import path from 'node:path'
import { requireAuth } from './auth.js'
import { getMatchWeights, MATCH_ALGORITHM_VERSION, scoreCandidate } from './matching.js'
import { extractCandidateInfo, extractResumeText, inspectResume, ResumeProcessingError } from './resumeProcessing.js'

const employmentTypes = new Set(['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERNSHIP'])
const jobStatuses = new Set(['ACTIVE', 'PAUSED', 'CLOSED'])
const reviewStatuses = new Set(['NEW', 'REVIEWING', 'SHORTLISTED', 'REJECTED', 'HIRED'])
const idIsValid = (id) => /^\d+$/.test(String(id)) && Number(id) > 0
const boundedPage = (value, fallback, max) => {
  const parsed = value === undefined ? fallback : Number(value)
  return Number.isInteger(parsed) && parsed >= (max === 100 ? 1 : 0) && parsed <= max ? parsed : null
}
const extractExperienceYears = (text) => {
  const match = text.match(/\b(\d{1,2})\s*\+?\s*(?:years?|yrs?)\s*(?:of\s*)?(?:professional\s*)?(?:experience|exp)\b/i)
  return match ? Number(match[1]) : null
}

function validateJob(body) {
  const errors = {}
  const strings = { title: 160, department: 100, location: 160, description: 12000 }
  for (const [field, max] of Object.entries(strings)) {
    const value = body?.[field]
    if (typeof value !== 'string' || !value.trim() || value.trim().length > max || (field === 'description' && value.trim().length < 20)) errors[field] = `Enter a valid ${field}.`
  }
  if (!employmentTypes.has(body?.employmentType)) errors.employmentType = 'Choose a supported employment type.'
  for (const field of ['requiredSkills', 'preferredSkills']) {
    const values = body?.[field] ?? (field === 'preferredSkills' ? [] : null)
    if (!Array.isArray(values) || (field === 'requiredSkills' && !values.length) || values.length > 50 || values.some((v) => typeof v !== 'string' || !v.trim() || v.trim().length > 100)) errors[field] = 'Provide a valid list of skills (up to 50).'
    else if (new Set(values.map((value) => value.trim().toLocaleLowerCase())).size !== values.length) errors[field] = 'Skills must not contain duplicates.'
  }
  for (const field of ['minExperienceYears', 'maxExperienceYears']) {
    const value = body?.[field]
    if (value !== null && value !== undefined && (!Number.isInteger(value) || value < 0 || value > 80)) errors[field] = 'Experience years must be an integer from 0 to 80.'
  }
  if (body?.minExperienceYears != null && body?.maxExperienceYears != null && body.maxExperienceYears < body.minExperienceYears) errors.maxExperienceYears = 'Maximum experience must be greater than or equal to minimum experience.'
  if (body?.status !== undefined && !jobStatuses.has(body.status)) errors.status = 'Choose a supported job status.'
  return errors
}

async function loadJob(pool, id) {
  const [rows] = await pool.execute('SELECT * FROM jobs WHERE id = ?', [id])
  if (!rows.length) return null
  const job = rows[0]
  const [[required], [preferred]] = await Promise.all([
    pool.execute('SELECT skill FROM job_required_skills WHERE job_id = ? ORDER BY skill_order', [id]),
    pool.execute('SELECT skill FROM job_preferred_skills WHERE job_id = ? ORDER BY skill_order', [id]),
  ])
  return {
    id: job.id,
    title: job.title,
    department: job.department,
    location: job.location,
    employmentType: job.employment_type,
    description: job.description,
    minExperienceYears: job.min_experience_years,
    maxExperienceYears: job.max_experience_years,
    status: job.status,
    createdAt: job.created_at,
    updatedAt: job.updated_at,
    requiredSkills: required.map((x) => x.skill),
    preferredSkills: preferred.map((x) => x.skill),
  }
}

async function saveSkills(connection, table, jobId, skills) {
  await connection.execute(`DELETE FROM ${table} WHERE job_id = ?`, [jobId])
  if (skills.length) await connection.query(`INSERT INTO ${table} (job_id, skill_order, skill) VALUES ?`, [skills.map((skill, index) => [jobId, index, skill.trim()])])
}

async function candidateById(pool, id) {
  const [rows] = await pool.execute('SELECT id, full_name AS fullName, email, phone, location, experience_years AS experienceYears, profile_summary AS profileSummary, created_at AS createdAt, updated_at AS updatedAt FROM candidates WHERE id = ?', [id])
  if (!rows.length) return null
  const [resumes] = await pool.execute('SELECT id, original_filename AS originalFilename, content_type AS contentType, size_bytes AS sizeBytes, processing_status AS processingStatus, created_at AS createdAt FROM resumes WHERE candidate_id = ? ORDER BY created_at DESC', [id])
  return { ...rows[0], resumes }
}

export function mountRoutes(app, { pool, env = process.env }) {
  const maxResumeBytes = Number(env.RESUME_MAX_FILE_SIZE_BYTES || 10 * 1024 * 1024)
  if (!Number.isSafeInteger(maxResumeBytes) || maxResumeBytes < 1 || maxResumeBytes > 100 * 1024 * 1024) throw new Error('RESUME_MAX_FILE_SIZE_BYTES must be between 1 byte and 100 MiB.')
  const matchWeights = getMatchWeights(env)
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: maxResumeBytes, files: 1 } })
  const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
  const frontendRoot = path.join(projectRoot, 'frontend')
  const configuredStorage = env.RESUME_STORAGE_DIR || './backend-node/storage/resumes'
  const storageRoot = path.resolve(projectRoot, configuredStorage)
  const storageRelativeToFrontend = path.relative(frontendRoot, storageRoot)
  if (!storageRelativeToFrontend || (!storageRelativeToFrontend.startsWith('..') && !path.isAbsolute(storageRelativeToFrontend))) {
    throw new Error('RESUME_STORAGE_DIR must be outside the frontend directory.')
  }
  app.use('/api', requireAuth)

  app.get('/api/jobs', async (req, res, next) => {
    const page = boundedPage(req.query.page, 0, 1000000)
    const size = boundedPage(req.query.size, 20, 100)
    if (page === null || size === null) return res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Invalid page or size.' })
    const filters = []; const params = []
    if (req.query.q) { filters.push('(title LIKE ? OR department LIKE ? OR location LIKE ?)'); params.push(...Array(3).fill(`%${String(req.query.q).slice(0, 160)}%`)) }
    if (req.query.status) {
      if (!jobStatuses.has(req.query.status)) return res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Invalid status.' })
      filters.push('status = ?'); params.push(req.query.status)
    }
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : ''
    try {
      const [[{ total }]] = await pool.execute(`SELECT COUNT(*) AS total FROM jobs ${where}`, params)
      const [rows] = await pool.execute(`SELECT id, title, department, location, employment_type AS employmentType, description, min_experience_years AS minExperienceYears, max_experience_years AS maxExperienceYears, status, created_at AS createdAt, updated_at AS updatedAt FROM jobs ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`, [...params, size, page * size])
      const content = await Promise.all(rows.map(async (job) => {
        const [[required], [preferred]] = await Promise.all([
          pool.execute('SELECT skill FROM job_required_skills WHERE job_id = ? ORDER BY skill_order', [job.id]),
          pool.execute('SELECT skill FROM job_preferred_skills WHERE job_id = ? ORDER BY skill_order', [job.id]),
        ])
        return { ...job, requiredSkills: required.map((x) => x.skill), preferredSkills: preferred.map((x) => x.skill) }
      }))
      res.json({ content, page, size, totalElements: total, totalPages: Math.ceil(total / size) })
    } catch (error) { next(error) }
  })

  app.post('/api/jobs', async (req, res, next) => {
    const errors = validateJob(req.body)
    if (Object.keys(errors).length) return res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Please correct the job fields.', fieldErrors: errors })
    const connection = await pool.getConnection()
    try {
      await connection.beginTransaction()
      const b = req.body
      const [result] = await connection.execute('INSERT INTO jobs (title, department, location, employment_type, description, min_experience_years, max_experience_years, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))', [b.title.trim(), b.department.trim(), b.location.trim(), b.employmentType, b.description.trim(), b.minExperienceYears ?? null, b.maxExperienceYears ?? null, b.status || 'ACTIVE'])
      await saveSkills(connection, 'job_required_skills', result.insertId, b.requiredSkills)
      await saveSkills(connection, 'job_preferred_skills', result.insertId, b.preferredSkills || [])
      await connection.commit()
      res.status(201).json(await loadJob(pool, result.insertId))
    } catch (error) { await connection.rollback(); next(error) } finally { connection.release() }
  })

  app.get('/api/jobs/:id', async (req, res, next) => {
    if (!idIsValid(req.params.id)) return res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Invalid job id.' })
    try { const job = await loadJob(pool, req.params.id); job ? res.json(job) : res.status(404).json({ code: 'NOT_FOUND', message: 'Job not found.' }) } catch (error) { next(error) }
  })

  app.put('/api/jobs/:id', async (req, res, next) => {
    if (!idIsValid(req.params.id)) return res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Invalid job id.' })
    const errors = validateJob(req.body)
    if (Object.keys(errors).length) return res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Please correct the job fields.', fieldErrors: errors })
    const connection = await pool.getConnection()
    try {
      await connection.beginTransaction()
      const b = req.body
      const [result] = await connection.execute('UPDATE jobs SET title=?, department=?, location=?, employment_type=?, description=?, min_experience_years=?, max_experience_years=?, status=?, updated_at=UTC_TIMESTAMP(6) WHERE id=?', [b.title.trim(), b.department.trim(), b.location.trim(), b.employmentType, b.description.trim(), b.minExperienceYears ?? null, b.maxExperienceYears ?? null, b.status || 'ACTIVE', req.params.id])
      if (!result.affectedRows) { await connection.rollback(); return res.status(404).json({ code: 'NOT_FOUND', message: 'Job not found.' }) }
      await saveSkills(connection, 'job_required_skills', req.params.id, b.requiredSkills)
      await saveSkills(connection, 'job_preferred_skills', req.params.id, b.preferredSkills || [])
      await connection.commit()
      res.json(await loadJob(pool, req.params.id))
    } catch (error) { await connection.rollback(); next(error) } finally { connection.release() }
  })

  app.delete('/api/jobs/:id', async (req, res, next) => {
    if (!idIsValid(req.params.id)) return res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Invalid job id.' })
    try {
      const [result] = await pool.execute('DELETE FROM jobs WHERE id = ?', [req.params.id])
      if (!result.affectedRows) return res.status(404).json({ code: 'NOT_FOUND', message: 'Job not found.' })
      res.status(204).end()
    } catch (error) {
      if (error.code === 'ER_ROW_IS_REFERENCED_2') return res.status(409).json({ code: 'JOB_HAS_APPLICATIONS', message: 'Jobs with applications cannot be deleted. Close the job instead.' })
      next(error)
    }
  })

  app.get('/api/candidates', async (req, res, next) => {
    const page = boundedPage(req.query.page, 0, 1000000); const size = boundedPage(req.query.size, 20, 100)
    if (page === null || size === null) return res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Invalid page or size.' })
    const q = String(req.query.q || '').slice(0, 160); const where = q ? 'WHERE full_name LIKE ? OR email LIKE ? OR location LIKE ?' : ''; const params = q ? Array(3).fill(`%${q}%`) : []
    try {
      const [[{ total }]] = await pool.execute(`SELECT COUNT(*) AS total FROM candidates ${where}`, params)
      const [rows] = await pool.execute(`SELECT id, full_name AS fullName, email, phone, location, experience_years AS experienceYears, profile_summary AS profileSummary, created_at AS createdAt FROM candidates ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`, [...params, size, page * size])
      res.json({ content: rows, page, size, totalElements: total, totalPages: Math.ceil(total / size) })
    } catch (error) { next(error) }
  })

  app.get('/api/candidates/:id', async (req, res, next) => {
    if (!idIsValid(req.params.id)) return res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Invalid candidate id.' })
    try { const candidate = await candidateById(pool, req.params.id); candidate ? res.json(candidate) : res.status(404).json({ code: 'NOT_FOUND', message: 'Candidate not found.' }) } catch (error) { next(error) }
  })

  app.get('/api/jobs/:jobId/applications', async (req, res, next) => {
    const { jobId } = req.params
    const page = boundedPage(req.query.page, 0, 1000000); const size = boundedPage(req.query.size, 20, 100)
    if (!idIsValid(jobId) || page === null || size === null) return res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Invalid job id, page, or size.' })
    try {
      const [rows] = await pool.execute('SELECT a.id, a.job_id AS jobId, a.candidate_id AS candidateId, c.full_name AS candidateName, c.email AS candidateEmail, a.resume_id AS resumeId, r.original_filename AS resumeFilename, a.match_score AS matchScore, a.review_status AS status, a.created_at AS appliedAt, a.updated_at AS updatedAt FROM applications a JOIN candidates c ON c.id=a.candidate_id LEFT JOIN resumes r ON r.id=a.resume_id WHERE a.job_id=? ORDER BY a.created_at DESC LIMIT ? OFFSET ?', [jobId, size, page * size])
      const [[{ total }]] = await pool.execute('SELECT COUNT(*) AS total FROM applications WHERE job_id=?', [jobId])
      res.json({ content: rows, page, size, totalElements: total, totalPages: Math.ceil(total / size) })
    } catch (error) { next(error) }
  })

  app.post('/api/jobs/:jobId/applications', async (req, res, next) => {
    const { jobId } = req.params; const { candidateId, resumeId = null } = req.body || {}
    if (!idIsValid(jobId) || !idIsValid(candidateId) || (resumeId !== null && !idIsValid(resumeId))) return res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Valid jobId, candidateId, and optional resumeId are required.' })
    try {
      const [result] = await pool.execute("INSERT INTO applications (candidate_id, job_id, resume_id, review_status, created_at, updated_at) VALUES (?, ?, ?, 'NEW', UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))", [candidateId, jobId, resumeId])
      const [rows] = await pool.execute('SELECT a.id, a.job_id AS jobId, a.candidate_id AS candidateId, c.full_name AS candidateName, c.email AS candidateEmail, a.resume_id AS resumeId, r.original_filename AS resumeFilename, a.match_score AS matchScore, a.review_status AS status, a.created_at AS appliedAt, a.updated_at AS updatedAt FROM applications a JOIN candidates c ON c.id=a.candidate_id LEFT JOIN resumes r ON r.id=a.resume_id WHERE a.id=?', [result.insertId])
      res.status(201).json(rows[0])
    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ code: 'DUPLICATE_APPLICATION', message: 'This candidate already has an application for the job.' })
      if (error.code === 'ER_NO_REFERENCED_ROW_2') return res.status(404).json({ code: 'NOT_FOUND', message: 'Job, candidate, or resume not found.' })
      next(error)
    }
  })

  app.patch('/api/applications/:id/status', async (req, res, next) => {
    if (!idIsValid(req.params.id) || !reviewStatuses.has(req.body?.status)) return res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Provide a valid application id and status.' })
    try {
      const [result] = await pool.execute('UPDATE applications SET review_status=?, updated_at=UTC_TIMESTAMP(6) WHERE id=?', [req.body.status, req.params.id])
      if (!result.affectedRows) return res.status(404).json({ code: 'NOT_FOUND', message: 'Application not found.' })
      const [rows] = await pool.execute('SELECT a.id, a.job_id AS jobId, a.candidate_id AS candidateId, c.full_name AS candidateName, c.email AS candidateEmail, a.resume_id AS resumeId, r.original_filename AS resumeFilename, a.match_score AS matchScore, a.review_status AS status, a.created_at AS appliedAt, a.updated_at AS updatedAt FROM applications a JOIN candidates c ON c.id=a.candidate_id LEFT JOIN resumes r ON r.id=a.resume_id WHERE a.id=?', [req.params.id])
      res.json(rows[0])
    } catch (error) { next(error) }
  })

  app.post('/api/jobs/:jobId/match', async (req, res, next) => {
    if (!idIsValid(req.params.jobId)) return res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Invalid job id.' })
    try {
      const job = await loadJob(pool, req.params.jobId)
      if (!job) return res.status(404).json({ code: 'NOT_FOUND', message: 'Job not found.' })
      const [rows] = await pool.execute('SELECT a.id AS applicationId, a.review_status AS reviewStatus, c.id AS candidateId, c.full_name AS fullName, c.email, c.phone, c.location, c.experience_years AS experienceYears, c.profile_summary AS profileSummary, r.id AS resumeId, r.extracted_text AS extractedText FROM applications a JOIN candidates c ON c.id=a.candidate_id LEFT JOIN resumes r ON r.id=a.resume_id WHERE a.job_id=?', [job.id])
      const matches = rows.map((row) => ({ row, result: scoreCandidate(job, row, row.extractedText || '', { weights: matchWeights }) }))
      const connection = await pool.getConnection()
      try {
        await connection.beginTransaction()
        for (const { row, result } of matches) {
          await connection.execute('INSERT INTO match_results (application_id, algorithm_version, score, breakdown, calculated_at) VALUES (?, ?, ?, ?, UTC_TIMESTAMP(6)) ON DUPLICATE KEY UPDATE algorithm_version=VALUES(algorithm_version), score=VALUES(score), breakdown=VALUES(breakdown), calculated_at=VALUES(calculated_at)', [row.applicationId, MATCH_ALGORITHM_VERSION, result.score, JSON.stringify(result)])
        }
        await connection.commit()
      } catch (error) {
        await connection.rollback()
        throw error
      } finally { connection.release() }
      res.json({ jobId: job.id, algorithmVersion: MATCH_ALGORITHM_VERSION, weights: matchWeights, calculated: matches.length, message: 'Scores are decision support for recruiter review, not hiring decisions.' })
    } catch (error) { next(error) }
  })

  app.get('/api/jobs/:jobId/shortlist', async (req, res, next) => {
    if (!idIsValid(req.params.jobId)) return res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Invalid job id.' })
    const page = boundedPage(req.query.page, 0, 1000000)
    const size = boundedPage(req.query.size, 10, 100)
    const minScore = req.query.minScore === undefined || req.query.minScore === '' ? null : Number(req.query.minScore)
    const status = req.query.status ? String(req.query.status).toUpperCase() : null
    if (page === null || size === null || (minScore !== null && (!Number.isFinite(minScore) || minScore < 0 || minScore > 100)) || (status && !reviewStatuses.has(status))) return res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Invalid shortlist filter or pagination value.' })
    try {
      const job = await loadJob(pool, req.params.jobId)
      if (!job) return res.status(404).json({ code: 'NOT_FOUND', message: 'Job not found.' })
      const filters = ['a.job_id = ?']; const params = [job.id]
      const q = String(req.query.q || '').trim().slice(0, 160)
      if (q) { filters.push('(c.full_name LIKE ? OR c.email LIKE ?)'); params.push(`%${q}%`, `%${q}%`) }
      if (status) { filters.push('a.review_status = ?'); params.push(status) }
      if (minScore !== null) { filters.push('mr.score >= ?'); params.push(minScore) }
      const where = filters.join(' AND ')
      const [[{ total }]] = await pool.execute(`SELECT COUNT(*) AS total FROM applications a JOIN candidates c ON c.id=a.candidate_id LEFT JOIN match_results mr ON mr.application_id=a.id WHERE ${where}`, params)
      const direction = req.query.sort === 'asc' ? 'ASC' : 'DESC'
      const [rows] = await pool.execute(`SELECT a.id AS applicationId, a.review_status AS reviewStatus, c.id AS candidateId, c.full_name AS fullName, c.email, c.phone, c.location, c.experience_years AS experienceYears, mr.score, mr.algorithm_version AS algorithmVersion, mr.breakdown, mr.calculated_at AS calculatedAt FROM applications a JOIN candidates c ON c.id=a.candidate_id LEFT JOIN match_results mr ON mr.application_id=a.id WHERE ${where} ORDER BY mr.score IS NULL ASC, mr.score ${direction}, a.created_at DESC LIMIT ? OFFSET ?`, [...params, size, page * size])
      const content = rows.map((row) => {
        let stored = row.breakdown
        if (typeof stored === 'string') { try { stored = JSON.parse(stored) } catch { stored = null } }
        const result = stored || null
        return {
          applicationId: row.applicationId,
          candidate: { id: row.candidateId, fullName: row.fullName, email: row.email?.endsWith('@resume.invalid') ? null : row.email, phone: row.phone, location: row.location, experienceYears: row.experienceYears },
          score: row.score,
          algorithmVersion: row.algorithmVersion,
          calculatedAt: row.calculatedAt,
          breakdown: result?.explanation || null,
          reviewStatus: row.reviewStatus,
        }
      })
      res.json({ job: { id: job.id, title: job.title }, content, page, size, totalElements: total, totalPages: Math.ceil(total / size), sort: direction.toLowerCase(), decisionSupport: true })
    } catch (error) { next(error) }
  })

  app.post('/api/resumes/upload', upload.single('file'), async (req, res, next) => {
    if (!req.file) return res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Choose a PDF or DOCX resume.' })
    const jobId = req.query.jobId
    if (!idIsValid(jobId)) return res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Select a valid job before uploading a resume.' })

    let filePath
    let fileCreated = false
    let databaseCommitted = false
    let connection
    let transactionStarted = false
    let rollbackSucceeded = false
    let commitAttempted = false
    let storageKey
    try {
      const job = await loadJob(pool, jobId)
      if (!job) return res.status(404).json({ code: 'JOB_NOT_FOUND', message: 'The selected job no longer exists.' })

      const detected = await inspectResume(req.file)
      const key = randomUUID()
      filePath = path.join(storageRoot, `${key}.${detected.kind}`)
      storageKey = path.relative(storageRoot, filePath)
      await mkdir(storageRoot, { recursive: true })
      await writeFile(filePath, req.file.buffer, { flag: 'wx', mode: 0o600 })
      fileCreated = true

      const extractedText = (await extractResumeText(req.file.buffer, detected.kind)).slice(0, 2_000_000)
      if (extractedText.length < 20) {
        const code = detected.kind === 'pdf' ? 'SCANNED_PDF' : 'EMPTY_DOCUMENT'
        const message = detected.kind === 'pdf'
          ? 'This PDF has no extractable text. It may be scanned or image-only; OCR is not implemented.'
          : 'The DOCX contains too little readable text to process.'
        throw new ResumeProcessingError(code, message, 422)
      }
      const extractedInfo = extractCandidateInfo(extractedText, detected.originalFilename, job)
      const textFingerprint = createHash('sha256').update(extractedText.toLocaleLowerCase().replace(/\s+/g, ' ').trim()).digest('hex')
      const storedEmail = extractedInfo.email || `candidate-${textFingerprint}@resume.invalid`

      connection = await pool.getConnection()
      await connection.beginTransaction()
      transactionStarted = true

      const [existingRows] = await connection.execute('SELECT id FROM candidates WHERE email = ? LIMIT 1', [storedEmail])
      const existingCandidate = existingRows[0]
      if (existingCandidate) {
        const [duplicateRows] = await connection.execute('SELECT id FROM applications WHERE candidate_id = ? AND job_id = ? LIMIT 1', [existingCandidate.id, jobId])
        if (duplicateRows.length) throw new ResumeProcessingError('DUPLICATE_APPLICATION', 'This candidate already has an application for the selected job.', 409)
      }

      await connection.execute("INSERT INTO candidates (full_name, email, phone, experience_years, profile_summary, created_at, updated_at) VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6)) ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id), full_name=IF(VALUES(full_name) = 'Unidentified candidate', full_name, VALUES(full_name)), phone=COALESCE(VALUES(phone), phone), experience_years=COALESCE(VALUES(experience_years), experience_years), profile_summary=VALUES(profile_summary), updated_at=UTC_TIMESTAMP(6)", [extractedInfo.fullName, storedEmail, extractedInfo.phone, extractedInfo.experienceYears, extractedText.slice(0, 20000)])
      const [[candidate]] = await connection.execute('SELECT id FROM candidates WHERE email = ?', [storedEmail])
      const [resumeResult] = await connection.execute('INSERT INTO resumes (candidate_id, original_filename, storage_key, content_type, size_bytes, extracted_text, processing_status, processing_error, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))', [candidate.id, detected.originalFilename, storageKey, detected.contentType, req.file.size, extractedText, 'PROCESSED'])
      if (extractedInfo.skills.length) {
        await connection.query('INSERT INTO resume_skills (resume_id, skill_order, skill) VALUES ?', [extractedInfo.skills.map((skill, index) => [resumeResult.insertId, index, skill])])
      }
      const [applicationResult] = await connection.execute("INSERT INTO applications (candidate_id, job_id, resume_id, review_status, created_at, updated_at) VALUES (?, ?, ?, 'NEW', UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))", [candidate.id, jobId, resumeResult.insertId])
      const match = scoreCandidate(job, { experience_years: extractedInfo.experienceYears, profile_summary: extractedText }, extractedText, { weights: matchWeights })
      await connection.execute('INSERT INTO match_results (application_id, algorithm_version, score, breakdown, calculated_at) VALUES (?, ?, ?, ?, UTC_TIMESTAMP(6)) ON DUPLICATE KEY UPDATE algorithm_version=VALUES(algorithm_version), score=VALUES(score), breakdown=VALUES(breakdown), calculated_at=VALUES(calculated_at)', [applicationResult.insertId, MATCH_ALGORITHM_VERSION, match.score, JSON.stringify(match)])
      commitAttempted = true
      await connection.commit()
      transactionStarted = false
      databaseCommitted = true

      res.status(201).json({
        resumeId: resumeResult.insertId,
        candidate: { id: candidate.id, fullName: extractedInfo.fullName, email: extractedInfo.email, phone: extractedInfo.phone, experienceYears: extractedInfo.experienceYears, skills: extractedInfo.skills },
        application: { id: applicationResult.insertId, jobId: Number(jobId), status: 'NEW', matchScore: match.score, matchExplanation: match.explanation, algorithmVersion: MATCH_ALGORITHM_VERSION },
        originalFilename: detected.originalFilename,
        contentType: detected.contentType,
        sizeBytes: req.file.size,
        processingStatus: 'PROCESSED',
      })
    } catch (error) {
      if (transactionStarted && connection) {
        try { await connection.rollback(); rollbackSucceeded = true } catch { /* Preserve the new file if rollback state is uncertain. */ }
      }
      let safeToDelete = !transactionStarted || (rollbackSucceeded && !commitAttempted)
      if (fileCreated && !databaseCommitted && rollbackSucceeded && commitAttempted) {
        try {
          const [references] = await pool.execute('SELECT id FROM resumes WHERE storage_key = ? LIMIT 1', [storageKey])
          safeToDelete = references.length === 0
        } catch { safeToDelete = false }
      }
      if (fileCreated && !databaseCommitted && safeToDelete) await unlink(filePath).catch(() => {})
      if (error instanceof ResumeProcessingError) return res.status(error.status).json({ code: error.code, message: error.message })
      if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ code: 'DUPLICATE_APPLICATION', message: 'This candidate already has an application for the selected job.' })
      next(error)
    } finally {
      connection?.release()
    }
  })

  app.get('/api/resumes/:id/status', async (req, res, next) => {
    if (!idIsValid(req.params.id)) return res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Invalid resume id.' })
    try {
      const [rows] = await pool.execute('SELECT id AS resumeId, processing_status AS status, processing_error AS error, updated_at AS updatedAt FROM resumes WHERE id = ?', [req.params.id])
      if (!rows.length) return res.status(404).json({ code: 'NOT_FOUND', message: 'Resume not found.' })
      res.json(rows[0])
    } catch (error) { next(error) }
  })

  app.get('/api/resumes/:id', async (req, res, next) => {
    if (!idIsValid(req.params.id)) return res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Invalid resume id.' })
    try {
      const [rows] = await pool.execute('SELECT r.id AS resumeId, r.candidate_id AS candidateId, r.original_filename AS originalFilename, r.content_type AS contentType, r.size_bytes AS sizeBytes, r.processing_status AS processingStatus, r.processing_error AS processingError, r.created_at AS createdAt, c.full_name AS fullName, c.email, c.phone, c.experience_years AS experienceYears FROM resumes r JOIN candidates c ON c.id = r.candidate_id WHERE r.id = ?', [req.params.id])
      if (!rows.length) return res.status(404).json({ code: 'NOT_FOUND', message: 'Resume not found.' })
      const [skills] = await pool.execute('SELECT skill FROM resume_skills WHERE resume_id = ? ORDER BY skill_order', [req.params.id])
      const [applications] = await pool.execute('SELECT id, job_id AS jobId, review_status AS status, match_score AS matchScore FROM applications WHERE resume_id = ?', [req.params.id])
      const row = rows[0]
      res.json({ resume: row, candidate: { id: row.candidateId, fullName: row.fullName, email: row.email?.endsWith('@resume.invalid') ? null : row.email, phone: row.phone, experienceYears: row.experienceYears, skills: skills.map((skill) => skill.skill) }, applications })
    } catch (error) { next(error) }
  })

  app.use((error, _req, res, next) => {
    if (error instanceof multer.MulterError) return res.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ code: error.code, message: error.code === 'LIMIT_FILE_SIZE' ? `Resume exceeds the configured ${Math.ceil(maxResumeBytes / (1024 * 1024))} MiB limit.` : 'Invalid upload.' })
    next(error)
  })
}
