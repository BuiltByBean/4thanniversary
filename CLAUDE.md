# 4thanniversary

## Work from the issues board

Every piece of work here starts from a GitHub issue that you claim before the
first edit (Michael, 2026-11-05; catalogue rule "Work is tracked on the repo's
GitHub issues"). It keeps sessions running at the same time out of each other's
files, and the open issues are where a cold session finds out where things stand.

1. See what is taken and read each one's Where:
   `gh issue list -R BuiltByBean/4thanniversary --label "in progress"`
2. Pick an open, unassigned issue (P1 first) or file one with the task, bug or
   decision form's headings, then claim it:
   `gh issue edit N -R BuiltByBean/4thanniversary --add-assignee @me --add-label "in progress"`,
   plus a comment naming the session and its worktree. An earlier claim wins.
3. One issue, one session, one worktree:
   `git worktree add ../4thanniversary-N -b N-short-slug origin/main`
4. Every commit says `Part of #N`. `Closes #N` goes only in the commit that
   ticks the last Done when box; never close with a box unticked.
5. Before stopping, tick what is true and comment what is left. Work you find
   and were not asked to do becomes an issue, not a side quest.

Labels: one type (`bug`, `feature`, `chore`, `docs`, `ops`, `decision`), one
priority (`P1`, `P2`, `P3`), and `in progress`, `blocked`, `needs decision`,
`needs human`, `triage` as they apply. `idea` issues come from the Ideas app
and are triage until written up.
