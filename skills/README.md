# skills

Claude Code skill packages that wrap the tools in this repo. Each subdirectory is one skill (one `SKILL.md` per folder).

| Skill | What it does |
|-------|--------------|
| [`btch-download`](./btch-download/SKILL.md) | Download media from 19 social-media platforms via the `btch` CLI. |

## Install into Claude Code

Copy or symlink a skill folder into your Claude Code skills directory:

```bash
# user-wide (available in every project)
ln -s "$(pwd)/skills/btch-download" ~/.claude/skills/btch-download

# project-local
mkdir -p .claude/skills
ln -s "$(pwd)/skills/btch-download" .claude/skills/btch-download
```

Then restart Claude Code (or reload skills). Claude will offer the skill automatically when the user's request matches the triggers in the skill's frontmatter `description`.

## Skill file format

```markdown
---
name: <kebab-case-name>           # must match folder name
description: <triggers + summary> # used to decide when to load the skill
---

# Skill body (markdown)
Usage, commands, recipes, output contracts, prerequisites.
```

Skills are static markdown — the body is loaded into Claude's context when the skill activates. Keep them tight, action-oriented, and full of concrete examples.
