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

`pnpm verify` runs all checks (`check`, `test`). The pre-push hook runs it.
