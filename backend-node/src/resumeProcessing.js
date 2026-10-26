import path from 'node:path'
import { fileTypeFromBuffer } from 'file-type'
import mammoth from 'mammoth'
import { PDFParse } from 'pdf-parse'

const PDF_MIME = 'application/pdf'
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const knownSkills = [
  'JavaScript', 'TypeScript', 'Java', 'Python', 'C++', 'C#', 'Go', 'Ruby', 'PHP', 'React', 'Angular', 'Vue',
  'Node.js', 'Express', 'MySQL', 'PostgreSQL', 'SQL', 'MongoDB', 'AWS', 'Azure', 'GCP', 'Docker', 'Kubernetes',
  'Git', 'Linux', 'HTML', 'CSS', 'REST', 'GraphQL', 'Spring Boot', '.NET', 'Machine Learning', 'TensorFlow', 'PyTorch',
]

export class ResumeProcessingError extends Error {
  constructor(code, message, status = 422) {
    super(message)
    this.name = 'ResumeProcessingError'
    this.code = code
    this.status = status
  }
}

export function safeOriginalFilename(value) {
  const safe = String(value || 'resume').replace(/[\\/]/g, '_').replace(/[\u0000-\u001f\u007f]/g, '').trim()
  return (safe || 'resume').slice(0, 255)
}

export async function inspectResume(file) {
  const originalFilename = safeOriginalFilename(file.originalname)
  const extension = path.extname(originalFilename).toLowerCase()
  const detected = await fileTypeFromBuffer(file.buffer)
  const byExtension = extension === '.pdf' ? { kind: 'pdf', mime: PDF_MIME } : extension === '.docx' ? { kind: 'docx', mime: DOCX_MIME } : null
  if (!byExtension || !detected || detected.ext !== byExtension.kind || detected.mime !== byExtension.mime) {
    throw new ResumeProcessingError('UNSUPPORTED_FILE', 'Upload a valid PDF or DOCX document. The file extension and detected content must match.', 415)
  }
  const suppliedMime = file.mimetype?.toLowerCase()
  const acceptedSuppliedMime = new Set([byExtension.mime, 'application/octet-stream'])
  if (suppliedMime && !acceptedSuppliedMime.has(suppliedMime)) {
    throw new ResumeProcessingError('MIME_MISMATCH', 'The supplied file type does not match the detected document type.', 415)
  }
  return { kind: byExtension.kind, contentType: byExtension.mime, originalFilename }
}

export async function extractResumeText(buffer, kind) {
  try {
    if (kind === 'pdf') {
      const tail = buffer.subarray(Math.max(0, buffer.length - 2048)).toString('latin1')
      if (!tail.includes('startxref') || !tail.includes('%%EOF')) {
        throw new ResumeProcessingError('UNREADABLE_DOCUMENT', 'The PDF structure is incomplete or damaged.', 422)
      }
      const parser = new PDFParse({ data: buffer })
      try {
        const parsed = await parser.getText({ stopAtErrors: true })
        const text = (parsed.pages || []).map((page) => page.text || '').join('\n').replace(/\u0000/g, '').trim()
        if (!text) throw new ResumeProcessingError('SCANNED_PDF', 'This PDF has no extractable text. It may be scanned or image-only; OCR is not implemented.', 422)
        return text
      } finally {
        await parser.destroy()
      }
    }
    const parsed = await mammoth.extractRawText({ buffer })
    const text = (parsed.value || '').replace(/\u0000/g, '').trim()
    if (!text) throw new ResumeProcessingError('EMPTY_DOCUMENT', 'The DOCX contains no readable text.', 422)
    return text
  } catch (error) {
    if (error instanceof ResumeProcessingError) throw error
    const label = kind === 'pdf' ? 'PDF' : 'DOCX'
    throw new ResumeProcessingError('UNREADABLE_DOCUMENT', `The ${label} could not be read. It may be damaged, encrypted, or malformed.`, 422)
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function includesTerm(text, term) {
  return new RegExp(`(^|[^a-z0-9])${escapeRegExp(term.toLocaleLowerCase())}(?=$|[^a-z0-9])`, 'i').test(text)
}

export function extractCandidateInfo(text, originalFilename, job) {
  const normalizedText = text.toLocaleLowerCase()
  const email = text.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i)?.[0]?.toLowerCase() || null
  const phoneSearchText = text.replace(/\b\d{1,2}\s*\+?\s*(?:years?|yrs?)\b/gi, ' ')
  const phone = (phoneSearchText.match(/\+?\d[\d\s().-]{6,}\d/g) || [])
    .map((value) => value.trim().replace(/\s+/g, ' '))
    .find((value) => {
      const digits = value.replace(/\D/g, '')
      return digits.length >= 8 && digits.length <= 15
    }) || null
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const lineBeforeContact = lines[0]?.split(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i)[0]?.trim()
  const inferredHeader = lineBeforeContact?.match(/^([A-Za-z][A-Za-z'’-]*(?:\s+[A-Za-z][A-Za-z'’-]*){0,4})\s*$/)?.[1]
  const fullName = lines.find((line) =>
    line.length >= 2 && line.length <= 120 && !line.includes('@') && !/^resume|^curriculum vitae$/i.test(line) && !/\d{7}/.test(line),
  ) || inferredHeader || 'Unidentified candidate'
  const years = text.match(/\b(\d{1,2})\s*\+?\s*(?:years?|yrs?)\s*(?:of\s*)?(?:professional\s*)?(?:experience|exp)\b/i)
  const experienceYears = years ? Number(years[1]) : null
  const jobSkills = [...(job?.requiredSkills || []), ...(job?.preferredSkills || [])]
  const skillCatalog = [...new Set([...knownSkills, ...jobSkills])]
  const skills = skillCatalog.filter((skill) => includesTerm(normalizedText, skill)).slice(0, 100)
  return {
    fullName,
    email,
    phone,
    skills,
    experienceYears,
  }
}
