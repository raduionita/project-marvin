import { Tool, ToolMeta, Field } from '../types.js';

export default class FindIntegrationTool extends Tool {
  public meta: ToolMeta = {
    type: 'function',
    function: {
      name: 'find_integration',
      description: 'Look up the schema (fields, required fields, allowed values) of an action on a configured integration, e.g. create_post on a wordpress site. Call this before call_integration to learn which fields to send.',
      parameters: {
        type: 'object',
        properties: {
          integration: {
            type: 'string',
            description: 'Integration id as configured in marvin.json (e.g. gloobeam)',
          },
          action: {
            type: 'string',
            description: 'Action to inspect (e.g. create_post, list_posts)',
          },
        },
        required: ['integration', 'action'],
      }
    },
  }

  public async call(args: { integration: string, action: string }): Promise<{ [key: string]: any }> {
    this.logger.debug('[FindIntegrationTool.call]', args);

    const integration = this.engine.integrations[args.integration];
    if (!integration) {
      return { error: `integration "${args.integration}" does not exist`, integrations: Object.keys(this.engine.integrations) };
    }

    const info = integration.meta;
    const description = info.actions[args.action];
    if (description === undefined) {
      return {
        error: `action "${args.action}" does not exist on integration "${args.integration}"`,
        actions: Object.keys(info.actions),
      };
    }

    // use the curated config schema (populated by `marvin integrations add`),
    // which is a snapshot of live discovery at add-time, so the AI loop never
    // hits the network here.
    const configured = integration.config?.actions?.[args.action]?.fields as { [key: string]: { required?: boolean, type?: string, description?: string, enum?: string[] } } | undefined;
    let fields: Field[] = [];
    if (configured && Object.keys(configured).length) {
      fields = Object.entries(configured).map(([name, def]) => ({
        name,
        type: def.type || 'string',
        required: def.required === true,
        description: def.description || '',
        ...(def.enum ? { enum: def.enum } : {}),
      }));
    }

    const meta = integration.config?.meta as { target?: 'meta' | 'acf', fields?: { [key: string]: { required?: boolean, type?: string, description?: string } } } | undefined;
    const metaFields: Field[] = meta?.fields ? Object.entries(meta.fields).map(([name, def]) => ({
      name,
      type: def.type || 'string',
      required: def.required === true,
      description: def.description || '',
      meta: meta.target === 'acf' ? 'acf' : 'meta',
    })) : [];

    return {
      id: args.integration,
      type: info.type,
      url: integration.config?.endpoint || integration.config?.url || '',
      action: args.action,
      description,
      fields: [...fields, ...metaFields],
      required_fields: [...fields, ...metaFields].filter(f => f.required).map(f => f.name),
    };
  }
}
