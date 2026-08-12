import { Tool, ToolMeta } from '../types.js';

export default class CallIntegrationTool extends Tool {
  public meta: ToolMeta = {
    type: 'function',
    function: {
      name: 'call_integration',
      description: 'Call a configured 3rd party integration (e.g. a Wordpress site). Actions depend on the integration type (e.g. create_post, publish_post)',
      parameters: {
        type: 'object',
        properties: {
          integration: {
            type: 'string',
            description: 'Integration id as configured in marvin.json (e.g. gloobeam)',
          },
          action: {
            type: 'string',
            description: 'Action to run on the integration, e.g. create_post, publish_post',
          },
          params: {
            type: 'object',
            description: 'Action parameters (e.g. title, content, id)',
          },
        },
        required: ['integration', 'action'],
      }
    },
  }

  public async call(args: { integration: string, action: string, params?: { [key: string]: any } }) {
    console.debug('[CallIntegrationTool.call]', args);

    const integration = this.engine.integrations[args.integration];
    if (!integration) {
      return { error: `integration "${args.integration}" does not exist`, integrations: Object.keys(this.engine.integrations) };
    }

    return integration.call({ action: args.action, ...(args.params || {}) });
  }
}
