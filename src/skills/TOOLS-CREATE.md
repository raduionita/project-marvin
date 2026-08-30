# Create a Tool

You are creating a new Marvin tool. A tool is a single TypeScript class that
the agent (LLM) can call during a chat. Tools live in `~/.marvin/tools/` and are
loaded automatically from the file name.

## Tool file format

Each tool is a file `~/.marvin/tools/TOOL_NAME.ts` exporting a default class that
extends `Tool` (imported from `{MARVIN_ROOT}/src/types.js`):

```typescript
// ~/.marvin/tools/my_tool.ts
import { Tool, ToolMeta } from '{MARVIN_ROOT}/src/types.js';

export default class MyTool extends Tool {
  // should this tool stop the chat
  public stop: boolean = false;
  // tool descriptor
  public meta: ToolMeta = {
    type: 'function',
    group: 'general',
    function: {
      name: 'my_tool',
      description: 'Short, self-explanatory description of what the tool does',
      parameters: {
        type: 'object',
        properties: {
          paramName: {
            type: 'string', // string | number | integer | boolean | object | array
            description: 'What this parameter is for',
          },
        },
        required: ['paramName'],
      }
    },
  }

  public async call(args: { paramName: string }) {
    this.logger.debug('[MyTool.call]', args);

    // validate args
    if (!args.paramName) {
      return { error: 'my_tool: paramName is required' };
    }

    // ... do the work, always return a JSON-serializable object
    return { result: '...' };
  }
}
```

`{MARVIN_ROOT}` is the absolute path to the marvin installation folder. Keep it
literally in the import; the `marvin tools add` command replaces it for you.

## Rules

- File name must match the tool name (snake_case), e.g. tool `web_search` lives in `~/.marvin/tools/web_search.ts`.
- `meta.function.name` must be the same snake_case name as the file.
- Keep the `description` short and describe when to use the tool.
- Declare every parameter in `properties` with a clear `description`.
- List required parameters in `required`; everything else stays optional.
- The `call(args)` method MUST:
  - validate the inputs and return `{ error: '...' }` on bad input
  - return a plain JSON object (never throw to the agent)
- Log with `this.logger.debug('[ToolName.call]', args)`.
- Use the engine only when needed: `this.engine` (e.g. `this.engine.work`, `this.engine.integrations`, `this.engine.skills`).
- Respect the workspace: paths must stay inside `~/.marvin` (see `safeJoin` from `helpers/index.js` in `read_file.ts`/`edit_file.ts`).

## Examples to study

- `src/tools/get_date.ts` — minimal tool, no dependencies
- `src/tools/read_file.ts` / `edit_file.ts` — workspace file access
- `src/tools/list_files.ts` / `grep.ts` — workspace discovery and search
- `src/tools/memory.ts` — persistent memory (remember/recall/forget/list)
- `src/tools/marvin_config.ts` — reads/writes the config
- `src/tools/call_integration.ts` — calls a configured integration
- `src/tools/web_search.ts` — longer tool with error handling

## Output

Return ONLY the complete TypeScript source of the tool file. Do not wrap it in
a code fence, do not add explanations before or after. The first line must be
the `import` statement.
