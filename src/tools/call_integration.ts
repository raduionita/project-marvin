import type Engine from '../engine.js';
import { Tool, ToolMeta } from '../types.js';

export default class CallIntegrationTool extends Tool {
  // the meta is dynamic: rebuilt from the configured integrations so the LLM
  // sees the actual sites and their actions. loadIntegrations() refreshes it
  // once the integration instances are loaded (see Engine.loadIntegrations).
  public meta: ToolMeta;

  constructor(engine: Engine) {
    super(engine);
    this.meta = this.buildMeta();
  }

  // rebuild meta from the current config + loaded integrations
  public refresh(): void {
    this.meta = this.buildMeta();
  }

  private buildMeta(): ToolMeta {
    const integrations = Object.keys(this.engine.config.integrations || {});

    // collect the union of actions across the configured integration types,
    // deduped, so the enum stays valid
    const actions = new Map<string, string>();
    for (const [id, config] of Object.entries(this.engine.config.integrations || {})) {
      const type = config.type || '';
      const integration = this.engine.integrations[id];
      const info = integration ? integration.meta : { actions: {} };
      for (const [name, description] of Object.entries(info.tools)) {
        if (!actions.has(name)) actions.set(name, description);
      }
      if (type && !Object.keys(info.tools).length && !actions.has('request')) {
        // unknown/undescribed integration type: fall back to a generic action
        actions.set('request', 'Run a raw request against the integration');
      }
    }

    return {
      type: 'function',
      group: 'integration',
      function: {
        name: 'call_integration',
        description: 'Execute an action on a configured 3rd party integration (e.g. a Wordpress site). Use find_integration first to learn the required fields for the action.',
        parameters: {
          type: 'object',
          properties: {
            integration: {
              type: 'string',
              enum: integrations,
              description: 'Integration id as configured in marvin.json (e.g. gloobeam)',
            },
            action: {
              type: 'string',
              ...(actions.size ? { enum: Array.from(actions.keys()) } : {}),
              description: 'Action to run (e.g. create_post, publish_post)',
            },
            params: {
              type: 'object',
              description: 'Action parameters. Call find_integration with the integration and action to learn the exact fields and which are required (e.g. title, content, meta fields).',
            },
          },
          required: ['integration', 'action'],
        }
      },
    };
  }

  public async call(args: { integration: string, action: string, params?: { [key: string]: any } }) {
    this.logger.debug('[CallIntegrationTool.call]', Object.keys(args));

    const integration = this.engine.integrations[args.integration];
    if (!integration) {
      return { error: `integration "${args.integration}" does not exist`, integrations: Object.keys(this.engine.integrations) };
    }

    return integration.call({ action: args.action, ...(args.params || {}) });
  }
}
