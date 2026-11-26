// Runs the interactive mode of pi in the test process, with a virtual
// terminal. A test sends keys, then reads the component tree and the screen.
// Only tests import this file.

import {
  type CreateAgentSessionRuntimeFactory,
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
  type ExtensionFactory,
  InteractiveMode,
  SessionManager,
} from '@earendil-works/pi-coding-agent'
import type { Component, Terminal, TUI } from '@earendil-works/pi-tui'
import { Terminal as Emulator } from '@xterm/headless'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout as delay, setImmediate as nextTurn } from 'node:timers/promises'

import { models, rebaseSession } from '../scripts/fixture.ts'

const root = resolve(import.meta.dirname, '..')

const NAMED_KEYS: Readonly<Record<string, string>> = {
  enter: '\r',
  escape: '\u001B',
  tab: '\t',
  space: ' ',
  backspace: '\u007F',
  delete: '\u001B[3~',
  up: '\u001B[A',
  down: '\u001B[B',
  right: '\u001B[C',
  left: '\u001B[D',
  home: '\u001B[H',
  end: '\u001B[F',
  pageUp: '\u001B[5~',
  pageDown: '\u001B[6~',
}

function withModifiers(base: string, plain: string, ctrl: boolean, shift: boolean): string | undefined {
  const letter = /^[a-z]$/.test(base)
  if (ctrl && shift) return undefined
  if (ctrl) {
    if (letter) return String.fromCodePoint(base.charCodeAt(0) & 0x1f)
    return base === 'space' ? '\u0000' : undefined
  }
  if (shift) {
    if (letter) return base.toUpperCase()
    return base === 'tab' ? '\u001B[Z' : undefined
  }
  return plain
}

// Gives the bytes that a terminal without the Kitty keyboard protocol sends
// for a key such as `j`, `enter`, `ctrl+p`, or `alt+p`. It rejects a key that
// such a terminal cannot send, for example `ctrl+shift+p`.
export function encodeKey(key: string): string {
  if (key.length === 1) return key
  // The search starts before the last character, so `alt++` has the base `+`.
  const split = key.lastIndexOf('+', key.length - 2)
  const base = key.slice(split + 1)
  const modifiers = new Set(split === -1 ? [] : key.slice(0, split).split('+'))
  const plain = NAMED_KEYS[base] ?? (base.length === 1 ? base : undefined)
  if (plain === undefined) throw new Error(`Unknown key: ${key}`)

  const ctrl = modifiers.delete('ctrl')
  const shift = modifiers.delete('shift')
  const alt = modifiers.delete('alt')
  const bytes = modifiers.size === 0 ? withModifiers(base, plain, ctrl, shift) : undefined
  if (bytes === undefined) throw new Error(`Unsupported key: ${key}`)
  return alt ? `\u001B${bytes}` : bytes
}

// pi does not draw more than one frame in this time (`MIN_RENDER_INTERVAL_MS`
// in pi-tui is 16). After it, a render that pi requested is on the screen.
const FRAME_MS = 20

const DEVICE_ATTRIBUTES_QUERY = '\u001B[c'
const DEVICE_ATTRIBUTES_REPLY = '\u001B[?62;c'

// pi writes to a terminal emulator, so a test reads the same rows that a
// user sees.
class VirtualTerminal implements Terminal {
  readonly columns: number
  readonly rows: number
  readonly kittyProtocolActive = false
  readonly #emulator: Emulator
  #onInput: ((data: string) => void) | undefined

  constructor(columns: number, rows: number) {
    this.columns = columns
    this.rows = rows
    this.#emulator = new Emulator({ cols: columns, rows, allowProposedApi: true })
  }

  start(onInput: (data: string) => void): void {
    this.#onInput = onInput
  }

  stop(): void {
    this.#onInput = undefined
  }

  send(data: string): void {
    if (this.#onInput === undefined) throw new Error('The terminal is not started.')
    this.#onInput(data)
  }

  // The emulator parses its input later. The promise resolves when it has
  // parsed all the output up to this call.
  async screen(): Promise<string[]> {
    await new Promise<void>(done => this.#emulator.write('', done))
    const buffer = this.#emulator.buffer.active
    return Array.from(
      { length: this.rows },
      (_, row) =>
        buffer
          .getLine(buffer.viewportY + row)
          ?.translateToString(true)
          .trimEnd() ?? '',
    )
  }

  dispose(): void {
    this.#emulator.dispose()
  }

  drainInput(): Promise<void> {
    return Promise.resolve()
  }

  write(data: string): void {
    this.#emulator.write(data)
    // pi asks for the terminal colors at start and waits for this reply, which
    // marks the end of the color replies. With no reply, each start waits for
    // the timeout.
    if (data.includes(DEVICE_ATTRIBUTES_QUERY)) setImmediate(() => this.#onInput?.(DEVICE_ATTRIBUTES_REPLY))
  }

  moveBy(lines: number): void {
    if (lines > 0) this.write(`\u001B[${lines}B`)
    else if (lines < 0) this.write(`\u001B[${-lines}A`)
  }

  hideCursor(): void {
    this.write('\u001B[?25l')
  }

  showCursor(): void {
    this.write('\u001B[?25h')
  }

  clearLine(): void {
    this.write('\u001B[K')
  }

  clearFromCursor(): void {
    this.write('\u001B[J')
  }

  clearScreen(): void {
    this.write('\u001B[2J\u001B[H')
  }

  // The window title and the progress state are not on the screen.
  setTitle(): void {}
  setProgress(): void {}
  setProgramStatus(): void {}
}

function isComponent(value: unknown): value is Component {
  return typeof value === 'object' && value !== null && 'render' in value && typeof value.render === 'function'
}

function childrenOf(component: Component): Component[] {
  const children: unknown = 'children' in component ? component.children : undefined
  return Array.isArray(children) ? children.filter(isComponent) : []
}

function walk(component: Component, visit: (component: Component, depth: number) => void, depth = 0): void {
  visit(component, depth)
  for (const child of childrenOf(component)) walk(child, visit, depth + 1)
}

interface FocusSource {
  getFocusedComponent(): unknown
}

// `getFocusedComponent` is not in the `TUI` interface.
function hasFocusSource(tui: TUI): tui is TUI & FocusSource {
  return 'getFocusedComponent' in tui && typeof tui.getFocusedComponent === 'function'
}

export interface StartOptions {
  /** The extensions under test. No other extension, skill, or context file loads. */
  extensions?: ExtensionFactory[]
  /** Loads `fixtures/NAME.jsonl` as the session. */
  session?: string
  columns?: number
  rows?: number
}

export interface Pi extends AsyncDisposable {
  /** Sends keys, for example `press('ctrl+p', 'j', 'enter')`. */
  press(...keys: string[]): Promise<void>
  /** Sends text as typed characters. */
  type(text: string): Promise<void>
  /**
   * The rows of the terminal as plain text, one frame after the call. pi draws
   * the frame on its own schedule: a change that requests no render does not
   * show.
   */
  screen(): Promise<string[]>
  /** The class name of the focused component. */
  focused(): string | undefined
  /** True when an overlay is open. An overlay is not in the component tree. */
  hasOverlay(): boolean
  /** All components with this class name, in tree order. Overlays are not included. */
  find(className: string): Component[]
  /** The class names of the component tree, one per line, indented by depth. Overlays are not included. */
  tree(): string
  /** Resolves when the condition holds. Rejects with the tree and the screen after the timeout. */
  waitFor(condition: () => boolean | Promise<boolean>, timeoutMs?: number): Promise<void>
  /**
   * Starts again from the initial session with an empty editor. Call it before
   * each test of a file. Rejects if a test left the focus on another component.
   */
  reset(): Promise<void>
}

// `startPi` changes `process.env`, so only one pi can run in a process.
let active = false

export async function startPi(options: StartOptions = {}): Promise<Pi> {
  if (active) throw new Error('A pi from startPi is in use in this process. Dispose it before you start another.')
  active = true
  const cleanup = new AsyncDisposableStack()
  cleanup.defer(() => {
    active = false
  })
  try {
    return await start(options, cleanup)
  } catch (error) {
    await cleanup.disposeAsync()
    throw error
  }
}

// Each resource adds its release to `cleanup` when it is made, so a failure
// at any step releases all the earlier resources.
async function start(options: StartOptions, cleanup: AsyncDisposableStack): Promise<Pi> {
  const { extensions = [], session, columns = 80, rows = 24 } = options

  const runDir = realpathSync(mkdtempSync(join(tmpdir(), 'pi-cockpit-')))
  cleanup.defer(() => rmSync(runDir, { recursive: true, force: true }))
  const agentDir = join(runDir, 'agent')
  const sessionDir = join(runDir, 'sessions')
  const cwd = join(runDir, 'work')
  for (const dir of [agentDir, sessionDir, cwd]) mkdirSync(dir)
  writeFileSync(join(agentDir, 'models.json'), JSON.stringify(models))

  // Some pi code reads the agent directory and the network switches from the
  // environment, not from the services. Without these values a test reads the
  // user's agent directory and sends requests.
  const environment = { PI_CODING_AGENT_DIR: agentDir, PI_OFFLINE: '1', PI_SKIP_VERSION_CHECK: '1', PI_TELEMETRY: '0' }
  const savedEnvironment = Object.keys(environment).map(name => [name, process.env[name]] as const)
  cleanup.defer(() => {
    for (const [name, value] of savedEnvironment) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  })
  Object.assign(process.env, environment)

  const sessionFile = join(runDir, 'initial.jsonl')
  const writeSessionFile = (): void => {
    if (session === undefined) return
    writeFileSync(sessionFile, rebaseSession(readFileSync(join(root, 'fixtures', `${session}.jsonl`), 'utf8'), cwd))
  }
  writeSessionFile()

  // pi gives the TUI to a widget factory. The widget is removed at once, so
  // it does not change the layout.
  let captured: TUI | undefined
  let setEditorText: ((text: string) => void) | undefined
  const captureTui: ExtensionFactory = pi => {
    pi.on('session_start', (_event, ctx) => {
      setEditorText = text => ctx.ui.setEditorText(text)
      ctx.ui.setWidget('harness', instance => {
        captured = instance
        return { render: () => [], invalidate: () => {} }
      })
      ctx.ui.setWidget('harness', undefined)
    })
  }

  const createRuntime: CreateAgentSessionRuntimeFactory = async ({ cwd: sessionCwd, sessionManager, sessionStartEvent }) => {
    const services = await createAgentSessionServices({
      cwd: sessionCwd,
      agentDir,
      resourceLoaderOptions: {
        extensionFactories: [captureTui, ...extensions],
        noExtensions: true,
        noSkills: true,
        noPromptTemplates: true,
        noThemes: true,
        noContextFiles: true,
      },
    })
    return {
      ...(await createAgentSessionFromServices({ services, sessionManager, sessionStartEvent })),
      services,
      diagnostics: services.diagnostics,
    }
  }
  const runtime = await createAgentSessionRuntime(createRuntime, {
    cwd,
    agentDir,
    sessionManager: session === undefined ? SessionManager.create(cwd, sessionDir) : SessionManager.open(sessionFile, sessionDir),
  })
  cleanup.defer(async () => {
    await runtime.dispose()
  })

  const terminal = new VirtualTerminal(columns, rows)
  cleanup.defer(() => terminal.dispose())
  const mode = new InteractiveMode(runtime, { terminal })
  // `init` adds signal handlers to the process. Only `stop` removes them.
  cleanup.defer(() => mode.stop())
  await mode.init()
  // The main loop takes each submitted prompt. It ends only when pi exits, so
  // the harness keeps the promise only to report an error.
  let loopError: unknown
  mode.run().catch((error: unknown) => {
    loopError = error
  })

  // The harness reads the focus through a pi internal. It stops here when a
  // pi update removes it, because `reset` cannot do its check without it.
  if (captured === undefined) throw new Error('pi did not give the TUI to the harness.')
  if (!hasFocusSource(captured)) throw new Error('The TUI of this pi has no getFocusedComponent. Update harness/pi.ts.')
  const tui = captured
  const focused = (): string | undefined => {
    const component = tui.getFocusedComponent()
    return isComponent(component) ? component.constructor.name : undefined
  }
  const initialFocus = focused()
  if (initialFocus === undefined) throw new Error('pi started with no focused component.')

  // Each key gets its own turn of the event loop, as from a real terminal.
  // pi then completes the work of one key before the next key arrives.
  const send = async (keys: string[]): Promise<void> => {
    for (const key of keys) {
      terminal.send(key)
      // oxlint-disable-next-line eslint/no-await-in-loop -- The keys arrive in sequence.
      await nextTurn()
    }
  }
  // The harness does not make pi render. A test then fails, as the user's
  // screen does, when the code changes state and requests no render.
  const screen = async (): Promise<string[]> => {
    await delay(FRAME_MS)
    return terminal.screen()
  }
  const tree = (): string => {
    const out: string[] = []
    for (const child of tui.children) walk(child, (component, depth) => out.push(`${'  '.repeat(depth)}${component.constructor.name}`))
    return out.join('\n')
  }

  return {
    press: async (...keys) => {
      await send(keys.map(encodeKey))
    },
    type: async text => {
      await send(Array.from(new Intl.Segmenter().segment(text), part => part.segment))
    },
    screen,
    tree,
    focused,
    hasOverlay: () => tui.hasOverlay(),
    find: className => {
      const found: Component[] = []
      for (const child of tui.children) walk(child, component => component.constructor.name === className && found.push(component))
      return found
    },
    waitFor: async (condition, timeoutMs = 2000) => {
      const deadline = performance.now() + timeoutMs
      let holds = await condition()
      while (!holds && performance.now() <= deadline) {
        // oxlint-disable-next-line eslint/no-await-in-loop -- A poll is sequential: each check follows a wait.
        holds = await delay(5).then(condition)
      }
      if (!holds) {
        throw new Error(`The condition did not hold in ${timeoutMs} ms.\n\nTree:\n${tree()}\n\nScreen:\n${(await screen()).join('\n')}`)
      }
    },
    reset: async () => {
      if (session === undefined) {
        await runtime.newSession()
      } else {
        writeSessionFile()
        await runtime.switchSession(sessionFile)
      }
      setEditorText?.('')
      if (focused() !== initialFocus || tui.hasOverlay()) {
        throw new Error(`The focus is on ${focused()}, not on ${initialFocus}, or an overlay is open. Close what a test opens.`)
      }
    },
    [Symbol.asyncDispose]: async () => {
      await cleanup.disposeAsync()
      if (loopError !== undefined) throw new Error('The main loop of pi failed.', { cause: loopError })
    },
  }
}
