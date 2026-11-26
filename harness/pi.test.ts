import { matchesKey } from '@earendil-works/pi-tui'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vite-plus/test'

import { encodeKey, type Pi, startPi } from './pi.ts'

describe('encodeKey', () => {
  // The key parser of pi is the oracle: pi must read the bytes as the same key.
  test.each([
    'j',
    '+',
    'enter',
    'escape',
    'tab',
    'space',
    'backspace',
    'delete',
    'up',
    'down',
    'left',
    'right',
    'home',
    'end',
    'pageUp',
    'pageDown',
    'ctrl+p',
    'ctrl+space',
    'alt+p',
    'alt+enter',
    'alt++',
    'shift+g',
    'shift+tab',
    'ctrl+alt+p',
  ] as const)('pi reads the bytes of %s as that key', key => {
    expect(matchesKey(encodeKey(key), key)).toBe(true)
  })

  test.each(['ctrl+shift+p', 'shift+ctrl+p', 'ctrl+enter', 'shift+enter', 'super+p'])('rejects %s, which it cannot encode', key => {
    expect(() => encodeKey(key)).toThrow(/Unsupported key/)
  })

  test('rejects a key name that it does not know', () => {
    expect(() => encodeKey('f13')).toThrow(/Unknown key/)
  })
})

describe('startPi', () => {
  let pi: Pi
  beforeAll(async () => {
    pi = await startPi({ session: 'usage' })
  })
  afterAll(async () => {
    await pi[Symbol.asyncDispose]()
  })
  beforeEach(async () => {
    await pi.reset()
  })

  test('shows the fixture session and puts the focus in the editor', async () => {
    expect(pi.focused()).toBe('CustomEditor')
    expect(pi.find('UserMessageComponent')).toHaveLength(3)
    expect((await pi.screen()).join('\n')).toContain('Summarize the planned features.')
  })

  test('typed text opens the command autocomplete', async () => {
    await pi.type('/mod')
    await pi.waitFor(async () => (await pi.screen()).some(line => line.includes('Select model')))
    expect(await pi.screen()).toContain('/mod')
  })

  test('reset removes the text that an earlier test typed', async () => {
    expect(await pi.screen()).not.toContain('/mod')
  })

  test('loads no skill or context file from the machine', async () => {
    const document = (await pi.screen()).join('\n')
    expect(document).not.toContain('[Skills]')
    expect(document).not.toContain('[Context]')
  })

  test('waitFor rejects with the tree when the condition does not hold', async () => {
    await expect(pi.waitFor(() => false, 20)).rejects.toThrow(/CustomEditor/)
  })
})

describe('startPi with an extension', () => {
  test('loads the extension under test and runs its command', async () => {
    const calls: string[] = []
    await using pi = await startPi({
      extensions: [
        api => {
          api.registerCommand('harness-probe', {
            description: 'A command from the test',
            handler: (args, ctx) => {
              calls.push(args)
              ctx.ui.notify('The probe ran.', 'info')
              return Promise.resolve()
            },
          })
        },
      ],
    })

    await pi.type('/harness-probe')
    await pi.waitFor(async () => (await pi.screen()).some(line => line.includes('A command from the test')))
    await pi.type(' now')
    await pi.press('enter')

    await pi.waitFor(() => calls.length === 1)
    expect(calls).toEqual(['now'])
    await pi.waitFor(async () => (await pi.screen()).join('\n').includes('The probe ran.'))
  })
})

const environment = (): (string | undefined)[] => ['PI_CODING_AGENT_DIR', 'PI_OFFLINE'].map(name => process.env[name])

describe('startPi failure paths', () => {
  test('a failed start restores the environment and lets the next start run', async () => {
    const before = environment()

    await expect(startPi({ session: 'no-such-fixture' })).rejects.toThrow(/ENOENT/)

    expect(environment()).toEqual(before)
    await using pi = await startPi()
    expect(pi.focused()).toBe('CustomEditor')
  })

  test('a second pi in the same process is rejected', async () => {
    await using _pi = await startPi()
    await expect(startPi()).rejects.toThrow(/in use/)
  })

  test('the screen does not show a change that requests no render', async () => {
    let show: (() => void) | undefined
    await using pi = await startPi({
      extensions: [
        api => {
          api.on('session_start', (_event, ctx) => {
            let lines: string[] = []
            ctx.ui.setWidget('silent', () => ({ render: () => lines, invalidate: () => {} }))
            show = () => {
              lines = ['A change with no render request']
            }
          })
        },
      ],
    })
    await pi.screen()

    show?.()

    expect((await pi.screen()).join('\n')).not.toContain('A change with no render request')
  })
})
