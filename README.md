# todo-dashboard

`todo-dashboard` is a local-first terminal task dashboard with independent concurrent timers. It installs the `todo` command, stores data in your operating system's per-user data directory, and supports both an interactive Ink interface and script-friendly commands.

Requires Node.js 22.12 or newer.

## Features

- Interactive terminal dashboard built with Ink, with responsive narrow, medium, and wide layouts.
- Concurrent timers: multiple tasks can run at the same time and keep tracking after the dashboard closes.
- Estimates, tracked time, effort remaining, progress, deadlines, Due In countdowns, and task health.
- Four priority levels: `low`, `medium`, `high`, and `urgent`.
- Search, filtering, sorting, keyboard shortcuts, task details, and interactive task creation/editing.
- Eight color themes, monochrome mode, ASCII borders, custom colors, and configurable visible columns.
- Script-friendly CLI output, JSON output, automatic backups, file locking, atomic writes, and store recovery diagnostics.

## Install

```sh
npm install --global todo-dashboard
```

Run `todo` in a terminal for the dashboard. When stdout is redirected, the same command prints one plain-text snapshot without terminal control characters.

To try the package without installing it globally:

```sh
npx todo-dashboard
```

To install the published CLI globally:

```sh
npm install --global todo-dashboard
todo
```

## Commands

```sh
todo add "Write release notes" --estimate "2h" --priority high --due "tomorrow 6pm"
todo list [--all] [--json]
todo show <id> [--json]
todo edit <id> [--title <text>] [--priority <level>] [--estimate <duration>] [--remaining <duration>]
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

Priority levels are `low`, `medium`, `high`, and `urgent`. New tasks default to `medium`. The interactive dashboard shows each level as a colored bracketed badge; monochrome mode keeps the label without color.

Multiple tasks may be running at once. Starting a task never pauses another task, and closing the dashboard does not stop timers.

The dashboard separates **Effort Left** (estimate minus tracked time) from **Due In** (calendar time until the deadline). A task with a deadline but no estimate still has a Due In countdown. Overdue deadlines are labeled as such. Wide terminals also show the absolute **Deadline**; `todo show <id>` shows all three timing values at any width.

## Dashboard keys

`↑`/`↓` or `j`/`k` navigate, `Enter` shows details, `n` creates, `e` edits, `s` starts, `p` pauses, `P` pauses all, `c` completes, `r` reopens, `d` deletes, `/` searches, `o` changes sorting, `,` opens settings, `?` shows help, and `q` quits.

The interactive dashboard uses pastel accents and bordered panels. Press `,` then `m` to switch to monochrome, or `,` then `u` to use ASCII borders and symbols. `NO_COLOR=1 todo` also disables dashboard colors.

### Dashboard appearance

Press `,` for settings, then `p` to cycle through the color themes. The settings screen previews each theme's border and selected row. Themes are `default`, `lavender-dusk`, `sage-cream`, `misty-blue`, `rose-slate`, `soft-amber`, `quiet-monochrome`, and `high-contrast`. The default theme remains unchanged.

Use `b` for the border color, `h` for headings, `a` for accents, `g` for the selected row background, `x` for selected row text, or `v` for visible columns. Enter colors as `#RRGGBB`; enter `default` to use the current theme's color. Custom color values take precedence over the selected theme. Column names are comma separated and appear in the order entered.

The same settings can be changed from the command line:

```sh
todo config set colorTheme sage-cream
todo config set borderColor '#7C3AED'
todo config set titleColor '#F9A8D4'
todo config set accentColor '#93C5FD'
todo config set selectedBackgroundColor '#312E81'
todo config set selectedTextColor '#FFFFFF'
todo config set visibleColumns 'state,task,effortLeft,dueIn,priority,health'
todo config set priorityColors '{"high":"#FBBF24","urgent":"#FB7185"}'
todo config set healthColors '{"OVERDUE":"#FB7185"}'
```

Available columns are `id`, `state`, `task`, `tracked`, `effortLeft`, `deadline`, `dueIn`, `progress`, `priority`, and `health`. The dashboard keeps its current responsive columns until you set `visibleColumns`. Color maps can be set with JSON; unspecified priority colors keep their current values. `todo config list` shows all saved settings.

## JSON and automation

Use `--json` when another script needs structured task data:

```sh
todo add "Deploy release" --estimate 45m --priority high --json
todo list --json
todo show <id> --json
```

Task IDs accept any unique prefix, which makes shell scripts easier to read while retaining unambiguous operations.

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

The package is published as `todo-dashboard` and exposes the `todo` executable. To release a new version, update the package metadata with npm and publish the generated build:

```sh
npm version patch --no-git-tag-version
npm run build
npm publish
```

## License

MIT
