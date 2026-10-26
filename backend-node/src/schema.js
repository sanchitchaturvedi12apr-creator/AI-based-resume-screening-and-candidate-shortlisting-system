import { readFile } from 'node:fs/promises'

export async function initializeApplicationSchema(pool) {
  const schemaUrl = new URL('../sql/schema.sql', import.meta.url)
  const schema = await readFile(schemaUrl, 'utf8')
  const statements = schema.split(';').map((statement) => statement.trim()).filter(Boolean)
  for (const statement of statements) {
    if (!/^CREATE TABLE IF NOT EXISTS\s/i.test(statement)) {
      throw new Error('Application schema contains a non-additive statement; refusing to initialize it.')
    }
    await pool.query(statement)
  }
}
