// Starts pi with this package in an isolated agent directory.
//
//   pnpm fixture [NAME] [-- PI_ARGS...]
//
// NAME loads fixtures/NAME.jsonl as the session. The agent directory is new
// for each run and is deleted at exit, so the user's auth.json, settings, and
// sessions are never read or changed. The fake provider points at a closed
// local port: a prompt fails at once and sends no request.

import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')

export const models = {
  providers: {
    fixture: {
      name: 'Fixture',
      baseUrl: 'http://127.0.0.1:1',
      api: 'openai-completions',
      apiKey: 'fixture',
      models: [{ id: 'fake', name: 'Fake', contextWindow: 200_000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
    },
  },
}

// pi resumes a session in the cwd of its header, so the committed fixture
// cannot hold an absolute path. The header gets the current cwd at run time.
export function rebaseSession(jsonl: string, cwd: string): string {
  const [header = '', ...rest] = jsonl.split('\n')
  const parsed: unknown = JSON.parse(header)
  if (typeof parsed !== 'object' || parsed === null || !('type' in parsed) || parsed.type !== 'session') {
    throw new Error('The first line of a fixture must be the session header.')
  }
  return [JSON.stringify({ ...parsed, cwd }), ...rest].join('\n')
}

function main(argv: string[]): number {
  const split = argv.indexOf('--')
  const own = split === -1 ? argv : argv.slice(0, split)
  const piArgs = split === -1 ? [] : argv.slice(split + 1)
  if (own.length > 1) {
    process.stderr.write('usage: pnpm fixture [NAME] [-- PI_ARGS...]\n')
    return 2
  }

  const runDir = mkdtempSync(join(tmpdir(), 'pi-cockpit-'))
  const agentDir = join(runDir, 'agent')
  try {
    mkdirSync(agentDir)
    writeFileSync(join(agentDir, 'models.json'), JSON.stringify(models, null, 2))
    const args = ['-e', root, '--model', 'fixture/fake']
    const [name] = own
    if (name !== undefined) {
      // Not in agentDir: at startup pi moves each *.jsonl in the agent
      // directory into sessions/, and --session then opens a missing file.
      const session = join(runDir, `${name}.jsonl`)
      writeFileSync(session, rebaseSession(readFileSync(join(root, 'fixtures', `${name}.jsonl`), 'utf8'), process.cwd()))
      args.push('--session', session)
    }
    const result = spawnSync(join(root, 'node_modules', '.bin', 'pi'), [...args, ...piArgs], {
      stdio: 'inherit',
      env: { ...process.env, PI_CODING_AGENT_DIR: agentDir, PI_OFFLINE: '1', PI_SKIP_VERSION_CHECK: '1', PI_TELEMETRY: '0' },
    })
    if (result.error !== undefined) throw result.error
    return result.status ?? 1
  } finally {
    rmSync(runDir, { recursive: true, force: true })
  }
}

if (import.meta.main) process.exitCode = main(process.argv.slice(2))
