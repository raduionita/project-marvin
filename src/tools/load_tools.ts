import { Tool, type ToolMeta } from '../types.js';
import type { Agent } from '../agent.js';
import type { Chat } from '../types.js';
import logger from '../logger.js';

export default class LoadToolsTool extends Tool {
  public meta: ToolMeta = {
    type: 'function',
    group: 'control',
    function: {
      name: 'load_tools',
      description: 'Load needed tools into this chat. ALWAYS load tools with `load_tools` before calling them.',
      parameters: {
        type: 'object',
        properties: {
          tools: {
            type: 'array',
            items: { type: 'string' },
            description: 'Names of tools to load (e.g. ["web_search", "mcpName__endpoint-tool"])',
          },
        },
        required: ['tools'],
      }
    },
  }

  public async call(args: { tools: string[] }, agent: Agent, chat: Chat): Promise<{ [key: string]: any }> {
    logger.debug('[LoadToolsTool.call]', `[${(Array.isArray(args?.tools) ? args.tools : []).join(',')}]`);

    const names = Array.isArray(args?.tools) ? args.tools : [];
    if (!names.length) {
      return { error: 'load_tools: no tool names provided' };
    }

    const loaded: string[] = [];
    const missing: string[] = [];

    chat.tools ||= [];

    for (const name of names) {
      // engine tool (internal + custom + mcp, all registered in Engine.tools)
      const tool = this.engine.tools[name];
      if (tool) {
        if (!chat.tools.some(t => t.function.name === name)) {
          chat.tools.push(tool.meta);
        }
        loaded.push(name);
        continue;
      }

      // neither engine nor mcp matched
      missing.push(name);
    }

    // drop duplicates shadowing engine tools (engine meta wins)
    if (chat.tools) {
      for (const [toolName, tool] of Object.entries(this.engine.tools)) {
        const idx = chat.tools.findIndex(t => t.function.name === toolName);
        if (idx !== -1) chat.tools[idx] = tool.meta;
      }
      const seen = new Set<string>();
      chat.tools = chat.tools.filter(t => {
        if (seen.has(t.function.name)) return false;
        seen.add(t.function.name);
        return true;
      });
    }

    for (const meta of chat.tools) {
      logger.debug('[LoadToolsTool.call]', meta.function.name, JSON.stringify(meta.function.parameters));
    }

    return { loaded , missing };
  }
}
