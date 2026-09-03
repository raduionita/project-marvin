import { Tool, ToolMeta } from '../types.js';
import logger from '../logger.js';

export default class MarvinStateTool extends Tool {
  public meta: ToolMeta = {
    type: 'function',
    group: 'marvin',
    function: {
      name: 'marvin_state',
      description: 'Read the current Marvin runtime state.',
      parameters: {
        type: 'object',
        properties: {
          area: {
            type: 'string',
            description: 'Optional filter: "agents", "tasks", "models", "channels", "skills", "mcps", or "settings"',
          },
        },
        required: [],
      }
    },
  }

  public async call(args: { area?: string }) {
    logger.debug('[MarvinStateTool.call]', Object.keys(args));

    const agents: Record<string, any> = {};
    const tasks: Record<string, any> = {};
    for (const [agentId, agent] of Object.entries(this.engine.agents)) {
      agents[agentId] = {
        enabled: agent.enabled,
        model: agent.model?.model ?? null,
        provider: agent.model?.provider ?? null,
        channels: agent.channels,
      };
    }

    for (const [taskId, task] of Object.entries(this.engine.tasks)) {
      tasks[`${task.agent?.id || '?'}/${taskId}`] = {
        enabled: task.enabled,
        schedule: task.schedule,
      };
    }

    const models: Record<string, any> = {};
    for (const [modelId, model] of Object.entries(this.engine.models)) {
      models[modelId] = {
        provider: model.provider,
        model: model.model,
        enabled: model.enabled,
        default: model.default,
      };
    }

    const channels: Record<string, any> = {};
    for (const [channelId, channel] of Object.entries(this.engine.channels)) {
      channels[channelId] = { enabled: true };
    }
    for (const [channelId, config] of Object.entries(this.engine.config.channels || {})) {
      channels[channelId] = { enabled: !!config.enabled };
    }

    const skills: Record<string, any> = {};
    for (const [skillId, skill] of Object.entries(this.engine.skills)) {
      skills[skillId] = { title: skill.title, description: skill.description, source: skill.source };
    }

    const settings = this.engine.config.settings || {};

    const all: Record<string, any> = { agents, tasks, models, channels, skills, settings };

    const area = args?.area;
    if (area) {
      if (!(area in all)) {
        return { error: `marvin_state: unknown area "${area}", use agents, tasks, models, channels, skills or settings` };
      }
      return { [area]: all[area] };
    }

    return all;
  }
}
