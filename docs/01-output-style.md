# Layer 1 — the Concise output style

The cheapest change is one line of settings:

```json
{
  "outputStyle": "Concise"
}
```

`Concise` is a built-in Claude Code output style. It tells the assistant to lead with the result, skip preamble and recap, keep simple answers to a sentence or three, and never trade correctness for brevity. It changes how Claude *talks*, not how it codes, but the two are linked: an assistant that narrates its work in chat narrates it in comments too.

## Where the line lives

Three settings files can carry it. Highest precedence first:

| File | Scope | Committed? |
|---|---|---|
| `.claude/settings.local.json` | you, this project | no (gitignored by convention) |
| `.claude/settings.json` | everyone, this project | yes |
| `~/.claude/settings.json` | you, every project | n/a |

The `/output-style Concise` command writes to the local project file. That is a personal choice. Moving the same line into `.claude/settings.json` and committing it is the act of making it a team default: every session in the repo gets it, and the change goes through review like any other.

The other built-in styles are `Default`, `Proactive`, `Explanatory`, and `Learning`. `Explanatory` and `Learning` do the opposite of what this playbook wants; they are for teaching, not shipping.

## What it looks like

Same question, "why does the build fail?", two styles.

Default:

> Let me take a look at the build output. I'll check the error message first and then look at the relevant file. It looks like the failure is caused by a missing import in `app.config.ts`. I'll explain what I found: the `provideRouter` symbol is used on line 12 but never imported. To fix this, I'll add the import. Let me know if you'd like me to proceed.

Concise:

> `app.config.ts:12` uses `provideRouter` without importing it. Adding the import fixes the build.

The style alone does not stop comment essays. It sets the tone; the next three layers enforce the rule.
