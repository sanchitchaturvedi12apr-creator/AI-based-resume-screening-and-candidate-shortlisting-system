export const MATCH_ALGORITHM_VERSION = 'rules-v1'
export const DEFAULT_MATCH_WEIGHTS = Object.freeze({ requiredSkills: 70, experience: 20, keywords: 10 })

const aliases = new Map([
  ['js', 'javascript'], ['javascript', 'javascript'], ['nodejs', 'node.js'], ['node js', 'node.js'], ['node.js', 'node.js'],
  ['reactjs', 'react'], ['react.js', 'react'], ['ts', 'typescript'], ['py', 'python'],
  ['postgres', 'postgresql'], ['postgre sql', 'postgresql'], ['amazon web services', 'aws'],
  ['google cloud platform', 'gcp'], ['k8s', 'kubernetes'], ['c sharp', 'c#'], ['cpp', 'c++'],
])
const stopWords = new Set('a an and are as at be by for from in into is of on or that the their this to with will you your we our'.split(' '))

export function normalizeSkill(value) {
  const normalized = String(value ?? '').toLocaleLowerCase().normalize('NFKC')
    .replace(/[^a-z0-9+#.]+/g, ' ').replace(/\s+/g, ' ').trim()
  return aliases.get(normalized) || normalized
}

function phraseTokens(value) {
  const canonical = normalizeSkill(value)
  return canonical ? canonical.replace(/[^a-z0-9+#]+/g, ' ').split(/\s+/).filter(Boolean) : []
}

function hasPhrase(haystack, needle) {
  if (!needle.length || needle.length > haystack.length) return false
  outer: for (let i = 0; i <= haystack.length - needle.length; i += 1) {
    for (let j = 0; j < needle.length; j += 1) if (haystack[i + j] !== needle[j]) continue outer
    return true
  }
  return false
}

function uniqueSkills(skills = []) {
  const result = new Map()
  for (const skill of Array.isArray(skills) ? skills : []) {
    const key = normalizeSkill(skill)
    if (key && !result.has(key)) result.set(key, String(skill).trim())
  }
  return [...result.entries()]
}

export function getMatchWeights(env = process.env) {
  const weights = {
    requiredSkills: Number(env.MATCH_WEIGHT_REQUIRED_SKILLS ?? DEFAULT_MATCH_WEIGHTS.requiredSkills),
    experience: Number(env.MATCH_WEIGHT_EXPERIENCE ?? DEFAULT_MATCH_WEIGHTS.experience),
    keywords: Number(env.MATCH_WEIGHT_KEYWORDS ?? DEFAULT_MATCH_WEIGHTS.keywords),
  }
  if (Object.values(weights).some((weight) => !Number.isFinite(weight) || weight < 0) || Object.values(weights).reduce((sum, value) => sum + value, 0) !== 100) {
    throw new Error('Match weights must be non-negative and sum to 100.')
  }
  return weights
}

function jobKeywords(description) {
  return [...new Set(String(description || '').toLocaleLowerCase().normalize('NFKC')
    .match(/[a-z0-9+#.]+/g)?.map((word) => word.replace(/^[+.]+|[+.]+$/g, ''))
    .filter((word) => word.length > 2 && !stopWords.has(word)) || [])]
}

export function scoreCandidate(job = {}, candidate = {}, resumeText = '', options = {}) {
  const weights = options.weights || DEFAULT_MATCH_WEIGHTS
  const rawText = [resumeText, candidate.profile_summary, ...(Array.isArray(candidate.skills) ? candidate.skills : [])].filter((value) => typeof value === 'string').join(' ')
  const candidateTokens = phraseTokens(rawText)
  const candidateKeywordTokens = rawText.toLocaleLowerCase().normalize('NFKC').match(/[a-z0-9+#.]+/g)?.map((word) => word.replace(/^[+.]+|[+.]+$/g, '')).filter(Boolean) || []
  const candidateTokenSet = new Set(candidateKeywordTokens)
  const requirements = uniqueSkills(job.requiredSkills ?? job.required_skills ?? [])
  const matchedRequired = []
  const missingRequired = []
  for (const [canonical, original] of requirements) {
    const variants = [...new Set([canonical, ...[...aliases].filter(([, value]) => value === canonical).map(([key]) => key)])]
    if (variants.some((variant) => hasPhrase(candidateTokens, phraseTokens(variant)))) matchedRequired.push(original)
    else missingRequired.push(original)
  }

  const minimumRaw = job.minExperienceYears ?? job.min_experience_years
  const minimum = minimumRaw === null || minimumRaw === undefined || minimumRaw === '' ? null : Number(minimumRaw)
  const experienceRaw = candidate.experienceYears ?? candidate.experience_years
  const experience = experienceRaw === null || experienceRaw === undefined || experienceRaw === '' || !Number.isFinite(Number(experienceRaw)) ? null : Number(experienceRaw)
  const experienceScore = experience === null || minimum === null ? null : minimum <= 0 ? 100 : Math.max(0, Math.min(100, (experience / minimum) * 100))

  const keywords = jobKeywords(job.description)
  const keywordsAvailable = rawText.trim().length > 0 && keywords.length > 0
  const matchedKeywords = keywordsAvailable ? keywords.filter((keyword) => candidateTokenSet.has(keyword)) : []
  const keywordScore = keywordsAvailable ? matchedKeywords.length / keywords.length * 100 : null
  const hasSkillEvidence = rawText.trim().length > 0
  const requiredScore = requirements.length && hasSkillEvidence ? matchedRequired.length / requirements.length * 100 : null

  const components = [
    { key: 'requiredSkills', weight: weights.requiredSkills, score: requiredScore },
    { key: 'experience', weight: weights.experience, score: experienceScore },
    { key: 'keywords', weight: weights.keywords, score: keywordScore },
  ]
  const usable = components.filter((component) => component.score !== null && component.weight > 0)
  const usableWeight = usable.reduce((sum, component) => sum + component.weight, 0)
  const score = usableWeight ? Math.round(usable.reduce((sum, component) => sum + component.score * component.weight, 0) / usableWeight) : null
  const unavailable = components.filter((component) => component.score === null).map((component) => component.key)

  return {
    score,
    algorithmVersion: MATCH_ALGORITHM_VERSION,
    explanation: {
      label: 'Deterministic rules based decision support for recruiter review. It does not make or recommend a hiring decision.',
      weights,
      components: Object.fromEntries(components.map(({ key, weight, score: componentScore }) => [key, {
        weight, score: componentScore === null ? null : Math.round(componentScore), contribution: componentScore === null ? null : Math.round(componentScore * weight) / 100,
        included: componentScore !== null && weight > 0,
      }])),
      denominatorWeight: usableWeight,
      missingData: unavailable,
      requiredSkills: {
        required: requirements.map(([, original]) => original),
        matched: matchedRequired,
        missing: hasSkillEvidence ? missingRequired : [],
        unverified: hasSkillEvidence ? [] : requirements.map(([, original]) => original),
        coverage: requiredScore === null ? null : Math.round(requiredScore),
      },
      experience: { candidateYears: experience, minimumYears: minimum, score: experienceScore === null ? null : Math.round(experienceScore), comparison: experience === null ? 'Candidate experience was not extracted.' : minimum === null ? 'The job has no minimum experience requirement.' : `${experience} of ${minimum} minimum years; score is min(candidate years / minimum years, 1) × 100.` },
      keywords: { total: keywords.length, matched: matchedKeywords, coverage: keywordScore === null ? null : Math.round(keywordScore), note: keywords.length ? 'Unique description tokens longer than two characters after stop word removal.' : 'No scorable job-description keywords were found.' },
      limitations: ['Only explicit normalized skill names and exact keyword tokens are compared.', 'Resume extraction may omit valid qualifications; missing evidence is not proof of lack of ability.', 'No protected characteristics or personal contact details are used. Recruiter review is required.'],
    },
  }
}
