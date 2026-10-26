import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileTypeFromBuffer } from 'file-type'
import mammoth from 'mammoth'
import { extractCandidateInfo, extractResumeText, inspectResume, safeOriginalFilename } from '../src/resumeProcessing.js'

function createPdf(text) {
  const safeText = text.replace(/[()\\]/g, '\\$&')
  const stream = `BT /F1 12 Tf 72 720 Td (${safeText}) Tj ET`
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

test('PDF parser extracts resume text from a PDF buffer', async () => {
  const buffer = createPdf('Riya Shah\nriya@example.com\n+1 415 555 0182\n4 years experience\nReact and Node.js')
  assert.deepEqual(await fileTypeFromBuffer(buffer), { ext: 'pdf', mime: 'application/pdf' })
  const inspected = await inspectResume({ originalname: 'resume.pdf', mimetype: 'application/pdf', buffer })
  const text = await extractResumeText(buffer, inspected.kind)
  assert.match(text, /Riya Shah/)
  const info = extractCandidateInfo(text, inspected.originalFilename, { requiredSkills: ['React', 'Node.js'], preferredSkills: [] })
  assert.equal(info.fullName, 'Riya Shah')
  assert.equal(info.email, 'riya@example.com')
  assert.equal(info.phone, '+1 415 555 0182')
  assert.equal(info.experienceYears, 4)
  assert.deepEqual(info.skills, ['React', 'Node.js'])
})

test('DOCX parser extracts text from a DOCX buffer', async () => {
  const fixture = new URL('../node_modules/mammoth/test/test-data/single-paragraph.docx', import.meta.url)
  const buffer = await readFile(fixture)
  assert.deepEqual(await fileTypeFromBuffer(buffer), { ext: 'docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
  const inspected = await inspectResume({ originalname: 'resume.docx', mimetype: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer })
  const text = await extractResumeText(buffer, inspected.kind)
  assert.ok(text.trim().length > 0)
})

test('invalid, empty, and unreadable documents return specific processing errors', async () => {
  assert.equal(safeOriginalFilename('..\\..\\private.pdf'), '.._.._private.pdf')
  await assert.rejects(() => inspectResume({ originalname: 'resume.pdf', mimetype: 'application/pdf', buffer: Buffer.from('not a pdf') }), { code: 'UNSUPPORTED_FILE' })
  await assert.rejects(() => extractResumeText(createPdf(''), 'pdf'), { code: 'SCANNED_PDF' })
  await assert.rejects(() => extractResumeText(Buffer.from('%PDF-not-readable'), 'pdf'), { code: 'UNREADABLE_DOCUMENT' })
})
