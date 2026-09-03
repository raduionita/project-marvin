import { Tool, ToolMeta } from '../types.js';
import type { Agent } from '../agent.js';
import type { Chat } from '../types.js';
import { loadMcpTools } from '../mcp.js';
import { splitMcpToolName } from '../helpers/index.js';
import logger from '../logger.js';

export default class LoadToolsTool extends Tool {
  public meta: ToolMeta = {
    type: 'function',
    group: 'control',
    function: {
      name: 'load_tools',
      description: 'Load one or more callable tools into this chat.',
      parameters: {
        type: 'object',
        properties: {
          tools: {
            type: 'array',
            items: { type: 'string' },
            description: 'Names of the tools to load (e.g. ["web_search", "mcp__endpoint-tool"])',
          },
        },
        required: ['tools'],
      }
    },
  }

  public async call(args: { tools: string[] }, agent: Agent, chat: Chat): Promise<{ [key: string]: any }> {
    logger.debug('[LoadToolsTool.call]', `[${(args?.tools || []).join(',')}]`);

    const names = Array.isArray(args?.tools) ? args.tools : [];
    if (!names.length) {
      return { error: 'load_tools: no tool names provided' };
    }

    const loaded: string[] = [];
    const missing: string[] = [];

    const mcpCache = new Map<string, ToolMeta[]>();

    for (const name of names) {
      // 1) engine tool (internal + custom)
      const tool = this.engine.tools[name];
      if (tool) {
        chat.tools ||= [];
        if (!chat.tools.some(t => t.function.name === name)) {
          chat.tools.push(tool.meta);
        }
        loaded.push(name);
        continue;
      }

      // 2) mcp tool (<mcpId>__<toolName>) - built via loadMcpTools
      let found = false;
      const mcpSplit = splitMcpToolName(name);
      if (mcpSplit) {
        const mcp = this.engine.mcps[mcpSplit.id];
        if (mcp) {
          let metas = mcpCache.get(mcpSplit.id);
          if (!metas) {
            metas = await loadMcpTools(this.engine, [mcpSplit.id]);
            mcpCache.set(mcpSplit.id, metas);
          }
          const meta = metas.find(m => m.function.name === name);
          if (meta) {
            chat.tools ||= [];
            if (!chat.tools.some(t => t.function.name === name)) {
              chat.tools.push(meta);
            }
            loaded.push(name);
            continue;
          }
          found = true;
        }
      }

      // neither engine nor mcp matched
      if (!found) {
      }
      missing.push(name);
    }

    return { loaded, missing };
  }
}
