import { Tool, ToolMeta } from '../types.js';
import type { Agent } from '../agent.js';
import type { Chat } from '../types.js';
import { loadIntegrationTools } from '../integrations/index.js';
import { loadMcpTools } from '../mcp.js';
import { splitIntegrationToolName, splitMcpToolName } from '../helpers/index.js';
import logger from '../logger.js';

export default class LoadToolsTool extends Tool {
  public meta: ToolMeta = {
    type: 'function',
    group: 'control',
    function: {
      name: 'load_tools',
      description: 'Load one or more callable tools into this chat. Pass the tool names (e.g. ["web_search", "integration__create_post", "mcp__custom-tool"]). Available tools are listed in the "## Available Tools", "## Integrations" and "## MCPs" sections of the system prompt. Integration tools use "<integrationId>__<tool>" and MCP tools use "<mcpId>__<tool>".',
      parameters: {
        type: 'object',
        properties: {
          names: {
            type: 'array',
            items: { type: 'string' },
            description: 'Names of the tools to load (e.g. ["web_search", "integration__create_post", "mcp__custom-tool"])',
          },
        },
        required: ['names'],
      }
    },
  }

  public async call(args: { names: string[] }, agent: Agent, chat: Chat): Promise<{ [key: string]: any }> {
    logger.debug('[LoadToolsTool.call]', Object.keys(args));

    const names = Array.isArray(args?.names) ? args.names : [];
    if (!names.length) {
      return { error: 'load_tools: no tool names provided' };
    }

    const loaded: string[] = [];
    const missing: string[] = [];

    // batch caches to avoid re-loading the same integration/mcp per call
    const integrationCache = new Map<string, ToolMeta[]>();
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

      // 2) integration tool (<integrationId>__<tool>) - built via loadIntegrationTools per Engine.loadIntegrations/execTask
      let found = false;
      const intSplit = splitIntegrationToolName(name);
      if (intSplit) {
        const integration = this.engine.integrations[intSplit.id];
        if (integration) {
          let metas = integrationCache.get(intSplit.id);
          if (!metas) {
            metas = await loadIntegrationTools(this.engine, [intSplit.id]);
            integrationCache.set(intSplit.id, metas);
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
          // integration exists but tool not found -> will be reported as missing after mcp check
          found = true;
        }
      }

      // 3) mcp tool (<mcpId>__<toolName>) - built via loadMcpTools per Engine.loadMcps/execTask
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

      // neither engine, integration, nor mcp matched
      if (!found) {
        // if name contained __ but neither integration nor mcp matched, still missing
      }
      missing.push(name);
    }

    return { loaded, missing };
  }
}
