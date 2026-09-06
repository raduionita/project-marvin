import { Tool, type ToolMeta } from '../types.js';
import type { Agent } from '../agent.js';
import type { Chat } from '../types.js';
import { loadMcpTool } from '../mcp.js';
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
      // 1) engine tool (internal + custom)
      const tool = this.engine.tools[name];
      if (tool) {
        if (!chat.tools.some(t => t.function.name === name)) {
          chat.tools.push(tool.meta);
        }
        loaded.push(name);
        continue;
      }

      // 2) mcp tool (<mcpId>__<toolName>) - loaded one-by-one
      const mcpSplit = splitMcpToolName(name);
      if (mcpSplit) {
        const meta = await loadMcpTool(this.engine, mcpSplit.id, name);
        if (meta) {
          if (!chat.tools.some(t => t.function.name === name)) {
            chat.tools.push(meta);
          }
          loaded.push(name);
          continue;
        }
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
