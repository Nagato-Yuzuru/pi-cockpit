# pi-cockpit

My own [pi](https://pi.dev) package: extensions that change the interface and the keys. It is for my personal use only.

## Install

```sh
pi install git:github.com/Nagato-Yuzuru/pi-cockpit
```

## Develop

```sh
mise trust && mise install
pnpm install
pnpm dev
```

`pnpm dev` starts the pinned pi with this package loaded. After a change, run `/reload` in pi.

`pnpm fixture [NAME] [-- PI_ARGS...]` starts pi with this package, a new agent directory, and a fake model provider. It does not use your credentials, and it sends no requests. `NAME` loads `fixtures/NAME.jsonl` as the session, for example `pnpm fixture usage -- --mode rpc`.

A behavior test (`extensions/NAME/behavior.test.ts`) runs the interactive mode of pi in the test process with `startPi` from `harness/pi.ts`. It sends keys and reads the screen. It uses no terminal, no credentials, and no network.

`pnpm verify` runs all checks (`check`, `test`). The pre-push hook runs it.
