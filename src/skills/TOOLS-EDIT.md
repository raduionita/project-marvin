# Edit a Tool

You are editing an existing Marvin tool. A tool is a single TypeScript class
that the agent (LLM) can call during a chat. Tools live in `~/.marvin/tools/`
and are loaded automatically from the file name.

You will be given the CURRENT source of the tool plus a description of the
change. Apply the change and return the COMPLETE, UPDATED file.

## Tool file format (unchanged parts)

Each tool is a file `~/.marvin/tools/TOOL_NAME.ts` exporting a default class that
extends `Tool` (imported from `{MARVIN_ROOT}/src/types.js`):

```typescript
// ~/.marvin/tools/my_tool.ts
import { Tool, ToolMeta } from '{MARVIN_ROOT}/src/types.js';

export default class MyTool extends Tool {
  public meta: ToolMeta = {
    type: 'function',
    group: 'general',
    function: {
      name: 'my_tool',
      description: 'Short, self-explanatory description of what the tool does',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      }
    },
  }

  public async call(args: { [key: string]: any }) {
    // ... do the work, always return a JSON-serializable object
    return { result: '...' };
  }
}
```

`{MARVIN_ROOT}` is the absolute path to the marvin installation folder. Keep it
literally in the import; the `marvin tools edit` command replaces it for you.

## Rules

- Keep the file name and `meta.function.name` unchanged unless you are told to
  rename the tool.
- Keep the existing `import` statements and `extends` clause; only touch what
  the requested change requires.
- Preserve `description`, parameter `description`s and the general shape of
  `meta` unless the change needs them updated.
- Only make the described edit - do NOT rewrite unrelated parts of the code,
  do not reformat the whole file, do not add speculative features.
- The `call(args)` method MUST:
  - validate the inputs and return `{ error: '...' }` on bad input
  - return a plain JSON object (never throw to the agent)
- Log with `this.logger.debug('[ToolName.call]', args)`.
- Respect the workspace: paths must stay inside `~/.marvin` (see
  `safeJoin` from `helpers/index.js` in `read_file.ts`/`edit_file.ts`).

## Output

Return ONLY the complete, updated TypeScript source of the tool file after
applying the change. Do not wrap it in a code fence, do not add explanations
before or after. The first line must be the `import` statement.
