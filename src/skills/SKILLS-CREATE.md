# Create a Skill

You are creating a new Marvin skill. A skill is a markdown file (`SKILL-NAME.md`)
that teaches Marvin how to perform a specialized task. Skills live in
`~/.marvin/skills/` and are loaded at engine start.

## Skill file format

A skill file is plain markdown with:

1. A single `# Title` heading (becomes the skill title shown in `marvin skills list`).
2. One short description paragraph right after the title.
3. The body: step-by-step instructions, rules, examples, and any reference material
   the agent needs to complete the task.

## Rules for writing a good skill

- Keep the title short and descriptive (e.g. `# Write Release Notes`).
- The description must be one clear sentence: what task does this skill handle?
- Write instructions the agent can follow without any external context:
  - concrete steps, numbered where order matters
  - what to read/write, what tools to call (`call_integration`, `edit_file`,
    `read_file`, `marvin_config`, `web_search`, ...)
  - do's and don'ts, format examples, edge cases
- Do not use front-matter, YAML, or code fences around the whole file.
- Aim for concise, actionable guidance. Avoid filler text.

## Example

```markdown
# Write Release Notes

Turn a list of merged changes into release notes.

## Steps
1. Ask for the list of merged commits if it was not provided.
2. Group changes by category (Features, Fixes, Performance, ...).
3. Write a short summary line per change, past tense, no internal jargon.
4. Return the notes as a markdown document.

## Rules
- Keep each entry to one sentence.
- Never invent changes that are not in the input.
```

## Output

Return ONLY the complete markdown content of the skill file. Do not wrap it in
a code fence, do not add explanations before or after. The first line must be
the `# Title` heading.
