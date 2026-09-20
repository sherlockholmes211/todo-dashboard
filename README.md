# todo-dashboard

`todo-dashboard` is a local-first terminal task dashboard with independent concurrent timers. It installs the `todo` command, stores data in your operating system's per-user data directory, and supports both an interactive Ink interface and script-friendly commands.

Requires Node.js 22.12 or newer.

## Install

```sh
npm install --global todo-dashboard
```

Run `todo` in a terminal for the dashboard. When stdout is redirected, the same command prints one plain-text snapshot without terminal control characters.

## Commands

```sh
todo add "Write release notes" --estimate "2h" --due "tomorrow 6pm"
todo list [--all] [--json]
todo show <id> [--json]
todo edit <id> [--title <text>] [--estimate <duration>] [--remaining <duration>]
                    [--due <deadline>] [--clear-estimate] [--clear-due]
todo start <id>
todo pause <id>
todo pause --all
todo done <id>
todo reopen <id>
todo delete <id> [--force]
todo config list
todo config get <key>
todo config set <key> <value>
todo doctor [--restore-backup]
```

IDs may be shortened to any unique prefix. Durations accept forms such as `45m`, `2h`, and `1h 30m`. Deadlines accept ISO/strict dates and natural language. A date without a time uses the configured `defaultDeadlineTime` (`23:59` initially).

Multiple tasks may be running at once. Starting a task never pauses another task, and closing the dashboard does not stop timers.

## Dashboard keys

`↑`/`↓` or `j`/`k` navigate, `Enter` shows details, `n` creates, `e` edits, `s` starts, `p` pauses, `P` pauses all, `c` completes, `r` reopens, `d` deletes, `/` searches, `o` changes sorting, `,` opens settings, `?` shows help, and `q` quits.

## Storage and recovery

Data is stored at the standard OS-specific user data path returned by `env-paths` under `todo-dashboard/store.json`. Mutations use an exclusive lock and atomic rename. `store.json.bak` contains the immediately previous valid revision. Invalid data is reported and never silently replaced; inspect it with `todo doctor` and explicitly restore with `todo doctor --restore-backup`.

## Development

```sh
npm test
npm run typecheck
npm run lint
npm run build
npm pack --dry-run
```

## License

MIT
