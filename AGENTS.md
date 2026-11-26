# pi-cockpit

pi-cockpit is a pi package for one user: the extensions that change pi's interface and keys. pi is the coding agent `@earendil-works/pi-coding-agent`. Its documentation is in `node_modules/@earendil-works/pi-coding-agent/docs/`; read `extensions.md` and `keybindings.md` before you change an extension.

## Architecture

pi supplies the events, the TUI, and the keybinding system. Do not build a second layer for these. Keep each extension thin: each abstraction of our own is one more thing to change when the pi API changes.

### Organize by feature

A feature is one interface change, for example vim keys in the selectors. Each feature is one pi extension in its own directory. pi loads every `extensions/*/index.ts` (see `pi.extensions` in `package.json`), so to remove a feature, delete its directory.

```
extensions/<name>/
  index.ts      # default export (pi: ExtensionAPI) => void; wiring only
  core.ts       # pure calculation; imports only types from pi
  core.test.ts
  behavior.test.ts  # the feature in a real pi; see Tests
shared/         # code that two or more features use
harness/        # runs pi in a test; only tests import it
```

A small feature can be only `index.ts`.

### Rules

- A feature does not import another feature. Dependencies go from `extensions` to `shared` only.
- Move code to `shared/` when a second feature needs it, not before.
- `core.ts` is pure. It imports only types from the `@earendil-works/*` packages.
- pi supplies the `@earendil-works/*` packages at run time. They are `peerDependencies` (`"*"`) and pinned `devDependencies` for the types. Never put them in `dependencies`.
- Do not write to the console: pi owns the terminal. Use `ctx.ui.notify`.
- Some pi internals are not in the public API (for example `tui.getFocusedComponent()`). An extension that uses one keeps the access in one place and fails safe when the internal is missing.

### Failure

- An extension must not break a session. On an error, the feature does nothing and pi keeps its default behavior.

### Tests

- Test `core.ts` with unit tests (`vp test`).
- Test a behavior in `extensions/<name>/behavior.test.ts` with `startPi` from `harness/pi.ts`. It runs the interactive mode of pi in the test process, with only the extensions that the test gives. The test sends keys, then reads the screen and the component tree.
- Write the behavior test first. Make sure that it fails for the correct reason, then write the code.
- State the intent with an explicit assertion. Wait with `pi.waitFor`, not with a fixed time.
- To check that pi loads a feature, run `pi -e . --mode rpc` and send `{"type":"get_commands"}` or another RPC command that shows the feature.
