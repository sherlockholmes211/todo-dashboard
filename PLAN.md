# `todo-dashboard` TUI — Updated Architecture and Execution Plan

## Summary

Build a TypeScript npm package named `todo-dashboard` that installs the executable command `todo`.

- `todo` opens a live terminal dashboard.
- Multiple task timers can run simultaneously.
- Tasks are stored globally for the current OS user.
- Only the task title is required.
- Estimates and deadlines enable progress, work-left, and schedule-health calculations.
- Traditional commands remain available for scripting.
- Target Node.js `>=22.12`.
- Publish the initial version as `0.1.0`.

### Core libraries

- **React:** Manages components and changing application state.
- **Ink:** Renders React components in the terminal and handles keyboard input.
- **Commander:** Parses commands and options such as `todo add --estimate 2h`.
- **Zod:** Validates commands, settings, and data loaded from storage.
- **chrono-node:** Parses natural-language deadlines.
- **env-paths:** Locates the correct per-user application-data directory.
- **Vitest and ink-testing-library:** Development-only automated testing.

## Architecture and Data

### Application layers

- **Domain layer:** Task types, validation rules, timer calculations, progress, schedule health, sorting, and filtering. Functions receive an injectable clock for deterministic tests.
- **Storage layer:** Reads and writes versioned JSON using locking, validation, backups, and atomic replacement.
- **Application layer:** Implements CRUD, timer operations, configuration, and task lookup using domain and storage services.
- **CLI interface:** Provides scriptable commands through Commander.
- **TUI interface:** Provides the interactive Ink dashboard.
- **Entrypoint:** The executable file launched by the `todo` command. It selects a subcommand when arguments are present, opens the TUI in an interactive terminal, or prints a single static dashboard when output is redirected.

### Task and store model

```ts
type Store = {
  schemaVersion: 1;
  revision: number;
  settings: Settings;
  tasks: Task[];
};

type Task = {
  id: string;
  title: string;
  status: "pending" | "in_progress" | "completed";
  estimateMs: number | null;
  trackedMs: number;
  activeSince: string | null;
  deadlineAt: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};
```

- Use UUIDs internally and accept unique ID prefixes from users.
- Store timestamps as UTC ISO strings and display them in the user's local timezone.
- Every task has its own `activeSince`, allowing multiple simultaneous timers.
- Starting an already-running or completed task returns a validation error.
- Completing a running task first records its current elapsed session.
- Reopening a completed task preserves its tracked time.

### Global storage

Use:

```ts
const paths = envPaths("todo-dashboard", {suffix: ""});
const storePath = join(paths.data, "store.json");
```

This resolves to the operating system's standard per-user data directory, such as Application Support on macOS, XDG data storage on Linux, or AppData on Windows.

The data directory contains:

```text
store.json
store.json.bak
store.json.lock   # exists only during a mutation
```

### Safe mutations and revisions

Every persisted change follows this sequence:

1. Create `store.json.lock` exclusively.
2. If another process owns the lock, wait briefly and retry.
3. Detect and recover stale locks left by crashed processes.
4. Reload and validate the newest `store.json`.
5. Apply exactly one requested operation.
6. Increment `revision`.
7. Copy the previous valid store to `store.json.bak`.
8. Write the new state to a temporary file and atomically rename it.
9. Remove the lock.

Only the current revision and immediately previous valid revision are retained.

```text
store.json       Revision 15
store.json.bak   Revision 14
```

The revision increments for meaningful changes such as creating, editing, starting, or pausing a task. TUI screen refreshes do not increment it.

### Validation rules

- Titles must contain non-whitespace characters and remain within a documented length limit.
- Estimates and remaining-time values must be positive.
- Deadlines must resolve to valid timestamps.
- Task ID prefixes must identify exactly one task.
- Completed tasks cannot start until reopened.
- Running tasks cannot be started again.
- Paused tasks cannot be paused again.
- Loaded JSON must match the current versioned schema.
- Invalid data is never silently replaced.

## Time and Health Calculations

### Effective tracked time

`trackedMs` contains completed timer sessions. A running session is calculated dynamically:

```text
effective spent =
  trackedMs + (current time - activeSince, when running)
```

Example:

```text
Previously tracked:       30 minutes
Current running session:  10 minutes
Effective spent:          40 minutes
```

### Work left and progress

```text
work left = max(estimate - effective spent, 0)
progress  = effective spent / estimate
```

- Missing estimate: show progress and work left as `—`.
- Incomplete tasks are capped visually at `99%`.
- Completed tasks display `100%`.
- Tasks exceeding their estimate display `ESTIMATE EXCEEDED by ...`.
- `--remaining 45m` changes the total estimate to effective time spent plus 45 minutes.

### Schedule health

```text
available calendar time = deadline - current time
schedule slack = available calendar time - work left
```

Health states:

- `DONE`: task completed.
- `OVERDUE`: deadline passed before completion.
- `ESTIMATE EXCEEDED`: estimated effort consumed without completion.
- `AT RISK`: remaining work exceeds available calendar time.
- `TIGHT`: remaining work consumes at least 75% of available calendar time.
- `ON TRACK`: sufficient schedule slack remains.
- `UNKNOWN`: estimate or deadline is missing.

Version 1 does not account for sleeping hours, working schedules, meetings, weekends, or holidays. Health is a calendar-time warning rather than a guaranteed forecast.

### Dynamic updates without repeated writes

Starting a timer writes `activeSince` once. The TUI recalculates elapsed time, work left, progress, deadlines, and health in memory every second.

Storage is written only when a user creates, edits, starts, pauses, completes, reopens, or deletes a task, or changes settings. Closing the TUI does not stop running timers.

## Public CLI and TUI Interfaces

### Commands

```text
todo
todo add <title> [--estimate <duration>] [--due <deadline>]
todo list [--all] [--json]
todo show <id> [--json]

todo edit <id>
  [--title <text>]
  [--estimate <duration>]
  [--remaining <duration>]
  [--due <deadline>]
  [--clear-estimate]
  [--clear-due]

todo start <id>
todo pause <id>
todo pause --all
todo done <id>
todo reopen <id>
todo delete <id> [--force]

todo config list
todo config get <key>
todo config set <key> <value>

todo doctor
todo doctor --restore-backup
todo --version
todo --help
```

- Accept durations such as `45m`, `2h`, and `1h 30m`.
- `todo start` affects only the selected task; other timers continue running.
- `todo pause <id>` pauses one timer.
- `todo pause --all` pauses every running timer in one locked mutation.
- Interactive deletion requires confirmation.
- Non-interactive deletion requires `--force`.
- Successful data goes to stdout.
- Errors go to stderr and return a nonzero exit code.
- `--json` provides stable machine-readable output.
- No programmatic JavaScript API is exported in v1.

### Terminal behavior

- When stdin and stdout are interactive TTYs, `todo` opens the TUI.
- When output is redirected, such as `todo > tasks.txt`, print one plain-text dashboard and exit.
- Do not output terminal control characters into pipes or files.
- Restore terminal state after normal exit, errors, or `Ctrl+C`.

### Deadline entry

Support all three entry styles through one validation pipeline:

- Natural language: `tomorrow 6pm`
- Strict or ISO: `2026-09-25 18:00`
- Guided TUI picker with separate date and time controls

A date without a time uses the configurable default of `23:59` local time.

### TUI controls

```text
↑/↓ or j/k   Select task
Enter        Open task details
n            Create task
e            Edit selected task
s            Start selected task
p            Pause selected task
P            Pause all running tasks
c            Complete selected task
r            Reopen selected task
d            Delete with confirmation
/            Search
f            Change filter
o            Change sorting
,            Open settings
?            Show help
q            Quit
```

The dashboard refreshes every second and uses an adaptive layout:

- Wide terminal: complete task table.
- Medium terminal: reduced columns.
- Narrow terminal: compact task list with selected-task details.
- Health is represented with text and symbols, not color alone.
- Respect the `NO_COLOR` environment variable.

### Customization

Version 1 settings include:

- Color theme and monochrome mode
- Unicode or ASCII symbols
- Progress-bar width
- 12-hour or 24-hour time
- Default time for date-only deadlines
- Default sorting
- Completed-task visibility
- Health-status colors

## Test-Driven Execution

### 1. Project foundation

- Initialize Git and npm.
- Configure TypeScript ESM and Node `>=22.12`.
- Add build, test, type-check, and lint scripts.
- Configure the `todo` executable.
- Add README, changelog, `.gitignore`, and MIT license.
- Add CI for Node 22 and 24 on Linux, macOS, and Windows.

### 2. Domain implementation

For each behavior, first write and observe a correctly failing test, then add minimal implementation.

Cover:

- Duration parsing
- Deadline normalization
- Task validation
- Multiple simultaneous timers
- Effective tracked time
- Progress and work-left calculations
- Estimate overruns
- Health classification
- Completion and reopening
- Filtering and sorting

### 3. Storage implementation

Test and implement:

- New-store initialization
- OS-specific path injection
- Schema validation
- Exclusive locking and stale-lock recovery
- Atomic replacement
- Revision increments
- Concurrent mutations
- Immediate previous-revision backup
- Corruption reporting and explicit recovery
- Future schema-migration entrypoint

### 4. Application and CLI

Test and implement:

- CRUD operations
- Unique short-ID resolution
- Independent start and pause operations
- Pause-all transaction
- Text and JSON output
- stderr and exit-code behavior
- Interactive confirmations
- Non-TTY static rendering
- Configuration and diagnostics

### 5. Interactive TUI

Test rendered frames and simulated keyboard input before implementing:

- Task navigation
- Responsive dashboard
- Independent running timers
- One-second calculated refresh
- Create and edit forms
- Natural, ISO, and guided deadlines
- Details, search, filtering, and sorting
- Settings and help
- Confirmation and recovery screens
- Terminal cleanup on exit

### 6. Packaging and publication

- Run the complete test, type-check, lint, and build suite.
- Run `npm pack --dry-run`.
- Inspect the package contents.
- Install the generated tarball into a temporary npm prefix.
- Smoke-test `todo --version`, CRUD commands, multiple timers, JSON output, and TUI startup.
- Recheck that `todo-dashboard` remains available.
- Publish `0.1.0` using `npm publish --access public`.

## Acceptance Criteria

- Multiple task timers run and update independently.
- Starting one task never pauses another.
- Running timers remain accurate after closing and reopening the application.
- Progress, work left, and health update every second without per-second disk writes.
- Concurrent terminal processes do not overwrite each other's changes.
- Each persisted mutation increments the revision exactly once.
- Only the current and immediately previous valid store snapshots are retained.
- Invalid or corrupt data is reported without silent data loss.
- All three deadline-entry approaches produce consistent UTC timestamps.
- The complete TUI is usable with arrow keys and without a mouse.
- Static and JSON output work correctly in pipes and redirected files.
- The packed npm artifact runs outside the repository on supported operating systems.
- Every production behavior is implemented only after its corresponding test has failed for the expected reason.

## Deferred Beyond Version 1

- Cloud synchronization and user accounts
- Team collaboration
- Per-project task stores
- Notifications
- Recurring tasks
- Subtasks and dependencies
- Full revision history and multi-step undo
- Working-hour, weekend, holiday, or calendar-aware scheduling
- Public JavaScript library API
