import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vite-plus/test'

import { rebaseSession } from './fixture.ts'

describe('rebaseSession', () => {
  test('sets the header cwd and keeps the entries', () => {
    const jsonl = '{"type":"session","version":3,"id":"s","cwd":"/fixture"}\n{"type":"message","id":"a"}\n'
    const [header, entry, end] = rebaseSession(jsonl, '/work').split('\n')
    expect(JSON.parse(header!)).toEqual({ type: 'session', version: 3, id: 's', cwd: '/work' })
    expect(entry).toBe('{"type":"message","id":"a"}')
    expect(end).toBe('')
  })

  test('rejects a file without a session header', () => {
    expect(() => rebaseSession('{"type":"message"}', '/work')).toThrow(/session header/)
  })

  test('accepts each committed fixture', () => {
    const text = readFileSync(join(import.meta.dirname, '..', 'fixtures', 'usage.jsonl'), 'utf8')
    expect(() => rebaseSession(text, '/work')).not.toThrow()
  })
})
