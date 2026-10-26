import test from 'node:test'
import assert from 'node:assert/strict'
import { initializeApplicationSchema } from '../src/schema.js'

test('startup schema initialization issues additive CREATE TABLE statements only', async () => {
  const statements = []
  await initializeApplicationSchema({ async query(sql) { statements.push(sql) } })
  assert.ok(statements.length >= 8)
  assert.ok(statements.every((sql) => /^CREATE TABLE IF NOT EXISTS\s/i.test(sql)))
  assert.ok(statements.some((sql) => /recruiter_users/.test(sql)))
  assert.ok(statements.some((sql) => /resume_skills/.test(sql)))
  assert.ok(statements.some((sql) => /match_results/.test(sql)))
  assert.equal(statements.some((sql) => /\bDROP\b|\bTRUNCATE\b/i.test(sql)), false)
})
