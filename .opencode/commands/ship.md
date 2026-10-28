---
description: Commit what is done, pull, push and restart the site (uses the release agent)
agent: release
subtask: true
---
Ship the current working tree. Extra instructions from the user: $ARGUMENTS
Current state: !`git status --short | head -30`
