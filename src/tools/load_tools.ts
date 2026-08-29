import { Tool, ToolMeta } from '../types.js';
import type { Agent } from '../agent.js';
import type { Chat } from '../types.js';

export default class LoadToolsTool extends Tool {
  public meta: ToolMeta = {
    type: 'function',
    group: 'control',
    function: {
      name: 'load_tools',
      description: 'Load one or more callable tools into this chat. Pass the tool names (e.g. ["read_file", "web_search"]). Available tools are listed in the "## Available Tools" section of the system prompt.',
      parameters: {
        type: 'object',
        properties: {
          names: {
            type: 'array',
            items: { type: 'string' },
            description: 'Names of the tools to load (e.g. ["read_file", "web_search"])',
          },
        },
        required: ['names'],
      }
    },
  }

  public async call(args: { names: string[] }, agent?: Agent, chat?: Chat): Promise<{ [key: string]: any }> {
    this.logger.debug('[LoadToolsTool.call]', Object.keys(args));

    const names = Array.isArray(args?.names) ? args.names : [];
    if (!names.length) {
      return { error: 'load_tools: no tool names provided' };
    }

    const loaded: string[] = [];
    const missing: string[] = [];

    for (const name of names) {
      const tool = this.engine.tools[name];
      if (!tool) {
        missing.push(name);
        continue;
      }

      if (chat) {
        chat.tools ||= [];
        if (!chat.tools.some(t => t.function.name === name)) {
          chat.tools.push(tool.meta);
        }
      }
      loaded.push(name);
    }

    return { loaded, missing };
  }
}
