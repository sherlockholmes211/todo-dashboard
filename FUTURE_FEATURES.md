# Future features

This document collects ideas that may be explored for `todo-dashboard`. Nothing here is scheduled or committed for implementation. Suggestions and alternative designs are welcome through project discussions or issues.

## Subtasks

**Status:** Proposed · Parked for future discussion

### Why subtasks?

A task such as “Prepare release” often contains several small steps. Today, those steps must live in the task title or description, or become separate top-level tasks. A lightweight subtask list could make the next action visible without filling the dashboard with extra rows.

The existing task model includes independent timers, estimates, deadlines, priority, and time-based progress. Subtasks should add useful structure without making those concepts ambiguous.

### Proposed first version

- Each task can have one level of subtasks, presented as a checklist. Subtasks cannot contain other subtasks.
- A subtask has a title and a completion state. It does not have its own timer, estimate, deadline, priority, or health status.
- The dashboard shows a compact count such as `2/4` only for tasks that have subtasks. It does not expand every subtask into a dashboard row.
- The Task Details view shows the checklist and supports adding, completing, reopening, editing, and deleting entries.
- Checking every subtask does not automatically complete the parent task. The user completes the parent explicitly.
- The parent task's existing progress bar remains based on tracked time and estimate. Checklist completion is displayed separately.

This is a deliberately small starting point. If users need independent scheduling or timers for a step, a regular task remains the better fit.

### Possible terminal experience

```text
TASK DETAILS
Prepare release                        [HIGH]  ON TRACK

SUBTASKS                              2/4 complete
  [x] Draft release notes
  [x] Review changes
› [ ] Publish package
  [ ] Announce release

a add · Space toggle · e edit · d delete · Esc back
```

The checklist should work at narrow terminal widths, in ASCII mode, and with `NO_COLOR`. Selection must remain clear without relying on color. Empty lists should show a short prompt such as “No subtasks yet — press `a` to add one.” Destructive actions should retain the app's confirmation pattern.

The keys above are suggestions. Task Details currently uses `Enter` and `Esc` to return to the dashboard, so making its rows navigable requires a deliberate update to that interaction.

### CLI and data considerations

The CLI should offer the same essential operations as the terminal UI. One possible command shape is:

```sh
todo subtask add <task-id> "Publish package"
todo subtask list <task-id>
todo subtask done <task-id> <subtask-id>
todo subtask reopen <task-id> <subtask-id>
todo subtask edit <task-id> <subtask-id> --title "Publish to npm"
todo subtask delete <task-id> <subtask-id>
```

Commands should keep the project's existing unique-prefix ID behavior and JSON output conventions. The exact command names and whether subtask IDs should be globally unique are still open for discussion.

The current store validates a versioned array of tasks. A simple one-level design could store subtasks in each parent task's ordered array, with a stable ID, title, creation time, and optional completion time. Adding that field requires an explicit plan for loading existing stores and backups, including any schema-version change or migration. Existing tasks must continue to load with an empty checklist; user data must not be discarded or silently rewritten on parse failure.

### Questions to settle before building

1. Should subtasks stay lightweight checklist items, or should some eventually become full tasks with timers and deadlines?
2. When all subtasks are complete, should the parent merely show `4/4`, or offer a prompt to complete it?
3. If a parent is completed or reopened, should its subtask states remain untouched? The proposed answer is yes.
4. What should happen to subtasks when a parent is deleted? The UI should make the outcome clear before deletion.
5. Should users be able to reorder subtasks, and should completed entries move to the bottom automatically?
6. Should task search match subtask titles, or search only top-level task titles?

### Suggested implementation path

1. Agree on the behavior above and the storage migration strategy.
2. Add the subtask domain model and service operations with tests for persistence, completion, deletion, and existing-store compatibility.
3. Add the CLI commands and JSON/plain-text output, with tests for IDs and error cases.
4. Add the navigable Task Details checklist and compact dashboard count; verify narrow, ASCII, and monochrome layouts.
5. Update the README and changelog once the feature ships.

The first release is successful if a user can break down a task, see what remains, update the checklist quickly, and still understand that the parent's timer and progress have their original meaning.
