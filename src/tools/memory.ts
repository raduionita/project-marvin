import { Tool, ToolMeta } from '../types';
import { saveMemory, readMemory, dropMemory, listMemories } from '../memory';
import { Agent } from '../agent';

export default class MemoryTool extends Tool {
  public meta: ToolMeta = {
    type: 'function',
    function: {
      name: 'memory',
      description: 'Persistent memory scoped to this agent, stored in ~/.marvin/memories/<agent-id>/. Operations: "remember" saves a note under a key, "recall" reads a note, "forget" deletes a note, "list" shows all notes. Use it to remember facts, preferences, and context across chats and restarts',
      parameters: {
        type: 'object',
        properties: {
          operation: {
            type: 'string',
            enum: ['remember', 'recall', 'forget', 'list'],
            description: 'What to do: remember (save), recall (read), forget (delete), or list (show all keys)',
          },
          key: {
            type: 'string',
            description: 'Name of the memory note (e.g. "user-preferences"). Required for remember, recall and forget',
          },
          content: {
            type: 'string',
            description: 'Text to store. Required for remember',
          },
        },
        required: ['operation'],
      }
    },
  }

  public async call(args: { operation: string; key?: string; content?: string }, agent?: Agent): Promise<{ [key: string]: any }> {
    this.logger.debug('[MemoryTool.call]', Object.keys(args));

    // memories are per-agent: use the calling agent, or the orchestrator when
    // the tool is invoked outside of an agent (e.g. `marvin tools memory ...`)
    const agentId = agent?.id || this.engine.config.settings.name;

    const operation = args?.operation;
    if (!operation) {
      return { error: 'memory: no operation provided (remember, recall, forget, list)' };
    }

    switch (operation) {
      case 'remember': {
        if (!args.key) {
          return { error: 'memory: no key provided for remember' };
        }
        if (args.content === undefined) {
          return { error: 'memory: no content provided for remember' };
        }
        return saveMemory(this.engine, agentId, args.key, args.content);
      }
      case 'recall': {
        if (!args.key) {
          return { error: 'memory: no key provided for recall' };
        }
        return readMemory(this.engine, agentId, args.key);
      }
      case 'forget': {
        if (!args.key) {
          return { error: 'memory: no key provided for forget' };
        }
        return dropMemory(this.engine, agentId, args.key);
      }
      case 'list': {
        return { notes: listMemories(this.engine, agentId) };
      }
      default:
        return { error: `memory: unknown operation "${operation}", use remember, recall, forget or list` };
    }
  }
}
