## What this changes

<!-- One paragraph. What is different after this merges, and why. -->

## Base branch

<!--
Leave "main" unless this stacks on another branch.

If it stacks: name the parent branch here. Whoever merges cannot guess it, and
merging a parent with squash rewrites its SHAs - which leaves this branch dead:
its content lands on the trunk but its commits stop existing, while `git log`
still shows it "ahead".
-->

main

## Merge method

<!--
Merge commit by default.
Squash only if nothing stacks on this branch and its commit history is noise.
-->

- [ ] Merge commit
- [ ] Squash — nothing stacks on this branch

## How this was verified

<!--
Name where you ran it, not just what you ran.

A green run in your everyday checkout proves your working tree works: that is
this branch PLUS everything uncommitted, yours and other people's. It is not
evidence about the branch.

Verify in a clean worktree from the trunk with this branch merged in:

    git worktree add ../<repo>-wt-verify --detach origin/main
    cd ../<repo>-wt-verify && git merge --no-commit --no-ff <this-branch>
-->

- [ ] Verified in a clean worktree, on this branch alone

Commands run and their result:

```
```

## Uncommitted or local state this depends on

<!--
Anything outside the branch that had to be present for the verification above:
a config file, a local deployment, someone else's uncommitted change.

"None" is the good answer. If it is not none, say so - a reviewer cannot
reproduce what is not written down, and a dependency on someone else's
uncommitted file disappears the moment they switch branches.
-->

None

## Risk

<!-- Anything that a reviewer should look at specifically. Delete if nothing. -->
