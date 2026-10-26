import test from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_MATCH_WEIGHTS, getMatchWeights, normalizeSkill, scoreCandidate } from '../src/matching.js'

const job = { requiredSkills: ['JavaScript', 'Node.js'], minExperienceYears: 4, description: 'Build JavaScript services with Node.js and databases.' }

test('perfect match scores 100 and exposes the configured component breakdown', () => {
  const result = scoreCandidate(job, { experienceYears: 8 }, 'JavaScript Node.js Build services with databases')
  assert.equal(result.score, 100)
  assert.deepEqual(result.explanation.weights, DEFAULT_MATCH_WEIGHTS)
  assert.equal(result.explanation.requiredSkills.coverage, 100)
  assert.equal(result.explanation.components.experience.contribution, 20)
})

test('partial coverage follows required skill fraction and minimum experience formula', () => {
  const result = scoreCandidate(job, { experienceYears: 2 }, 'JavaScript Build services')
  assert.deepEqual(result.explanation.requiredSkills.matched, ['JavaScript'])
  assert.deepEqual(result.explanation.requiredSkills.missing, ['Node.js'])
  assert.equal(result.explanation.requiredSkills.coverage, 50)
  assert.equal(result.explanation.experience.score, 50)
  assert.ok(result.score >= 0 && result.score <= 100)
})

test('no matches produce zero when all three components are calculable', () => {
  const result = scoreCandidate(job, { experienceYears: 0 }, 'Gardening and carpentry')
  assert.equal(result.score, 0)
  assert.deepEqual(result.explanation.requiredSkills.matched, [])
})

test('empty requirements and non-scorable descriptions are excluded rather than treated as perfect', () => {
  const result = scoreCandidate({ requiredSkills: [], minExperienceYears: null, description: 'the and or' }, { experienceYears: 5 }, 'Known candidate summary')
  assert.equal(result.explanation.components.requiredSkills.score, null)
  assert.equal(result.explanation.components.keywords.score, null)
  assert.deepEqual(result.explanation.missingData, ['requiredSkills', 'experience', 'keywords'])
  assert.equal(result.score, null)
})

test('missing experience is reported and remaining evidence weights are rescaled', () => {
  const result = scoreCandidate(job, {}, 'JavaScript Build services with databases')
  assert.equal(result.explanation.components.experience.score, null)
  assert.ok(result.explanation.missingData.includes('experience'))
  assert.equal(result.explanation.denominatorWeight, 80)
  assert.equal(result.score, 54)
})

test('incomplete resume evidence is not interpreted as a zero skill or keyword score', () => {
  const result = scoreCandidate(job, { experienceYears: 2 }, '')
  assert.equal(result.explanation.components.requiredSkills.score, null)
  assert.deepEqual(result.explanation.requiredSkills.missing, [])
  assert.deepEqual(result.explanation.requiredSkills.unverified, ['JavaScript', 'Node.js'])
  assert.equal(result.explanation.components.keywords.score, null)
  assert.equal(result.explanation.components.experience.score, 50)
  assert.equal(result.score, 50)
})

test('duplicate skills and known aliases normalize to one requirement', () => {
  assert.equal(normalizeSkill('  NODE-js '), 'node.js')
  assert.equal(normalizeSkill(' JS '), 'javascript')
  const result = scoreCandidate({ requiredSkills: ['JS', 'JavaScript', 'nodejs', 'Node.js'], minExperienceYears: 0, description: '' }, { experienceYears: 0 }, 'Javascript / NODE.JS')
  assert.equal(result.explanation.requiredSkills.required.length, 2)
  assert.deepEqual(result.explanation.requiredSkills.matched, ['JS', 'nodejs'])
})

test('skill matching respects exact token boundaries and punctuation normalization', () => {
  const result = scoreCandidate({ requiredSkills: ['Java'], minExperienceYears: 1, description: '' }, { experienceYears: 1 }, 'JavaScript specialist')
  assert.deepEqual(result.explanation.requiredSkills.matched, [])
  assert.deepEqual(result.explanation.requiredSkills.missing, ['Java'])
})

test('experience is bounded at 100 and handles a zero minimum safely', () => {
  const above = scoreCandidate({ requiredSkills: [], minExperienceYears: 4, description: '' }, { experienceYears: 40 }, '')
  assert.equal(above.explanation.experience.score, 100)
  const zero = scoreCandidate({ requiredSkills: [], minExperienceYears: 0, description: '' }, { experienceYears: 0 }, '')
  assert.equal(zero.explanation.experience.score, 100)
})

test('weights are configurable but must be non-negative and total 100', () => {
  assert.deepEqual(getMatchWeights({ MATCH_WEIGHT_REQUIRED_SKILLS: '60', MATCH_WEIGHT_EXPERIENCE: '30', MATCH_WEIGHT_KEYWORDS: '10' }), { requiredSkills: 60, experience: 30, keywords: 10 })
  assert.throws(() => getMatchWeights({ MATCH_WEIGHT_REQUIRED_SKILLS: '60', MATCH_WEIGHT_EXPERIENCE: '20', MATCH_WEIGHT_KEYWORDS: '10' }), /sum to 100/)
})
