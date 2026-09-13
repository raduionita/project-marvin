import { checkbox, confirm, input, password, select } from '../terminal.js';
import { listModels } from "../models";
import { detectBaseUrl, detectProvider } from '../helpers/index.js';
import { Command, Config, Provider } from "../types";
import { writeFileSync } from 'fs';
import { join } from 'path';
import logger from '../logger.js';

const PROVIDERS: Provider[] = ['openai', 'anthropic', 'google'];

export default class ModelsCommand extends Command {
  async exec() {
    logger.debug('[ModelsCommand.exec]');

    const act = this.args[0] || 'help';
    switch (act) {
      default:
        logger.warn('[ModelsCommand.exec]', 'unknown action: models', act);
      case '':
      case 'help': // default = empty = help
        this.execHelp();
        break;
      case 'list':
        this.execList();
        break;
      case 'add':
        await this.execAdd();
        break;
      case 'edit':
        await this.execEdit();
        break;
    }
  }

  execHelp() {
    logger.info('usage: marvin models [action]');
    logger.info('actions:');
    logger.info('  help    ', 'show this help');
    logger.info('  list    ', 'list available models, for each one, it\'s connected agents');
    logger.info('  add     ', 'add a model');
    logger.info('  edit    ', 'edit a model');
  }

  execList() {
    logger.info('list models:');
    // for each model, list enabled agents
    listModels(this.engine).forEach(modelId => {
      logger.info(`  ${modelId}`);
      const config = this.engine.config.models[modelId];
      if (config) {
        logger.info('  - enabled:', config.enabled);
      }
    });
  }

  async execAdd() {
    const config = {} as Config['models'][string];

    logger.log('');
    
    // enter the model name
    config['model'] = await input({ message: 'Enter model name (e.g. gpt-3.5-turbo):', required: true });
    
    // select the model provider
    config['provider'] = detectProvider(config['model']);
    config['provider'] = await select<Provider>({
      message: `Select provider (detected: ${config['provider']}):`,
      choices: PROVIDERS.map(p => ({ name: p, value: p })),
      default: config['provider'],
    });

    // select the model baseUrl
    config['baseUrl'] = detectBaseUrl(config['model'], config['provider']);
    config['baseUrl']  = (await input({ message: `Enter baseUrl (detected: ${config['baseUrl']}):`, default: config['baseUrl'] })) || config['baseUrl'];
    if (!config['baseUrl']) delete config['baseUrl'];
    
    // enter the model apiKey
    config['apiKey']   = await password({ message: 'Enter apiKey (e.g. sk-1234):' });
    
    // enable the model
    config['enabled'] = true;

    logger.log('');

    const modelId = config['provider'] + '/' + config['model'];

    this.engine.config.models[modelId] = config;

    // update selected agents binding
    const agentIds = Object.keys(this.engine.config.agents || {});
    // select agents to bind
    const picked = agentIds.length ? await checkbox({
      message: 'Select agents to use this model (space to toggle, enter for none):',
      choices: agentIds.map(id => ({ name: id, value: id })),
    }) : [];

    // for each selected, bind model to agent
    for (const id of picked) {
      const agent = this.engine.config.agents[id];
      if (!agent) {
        logger.warn('[ModelsCommand.bindAgents]', `unknown agent "${id}", skipping`);
        continue;
      }
      agent.model = modelId;
    }

    // save config
    this.saveConfig();
    
    logger.info(`model "${modelId}" configured, config updated`);
  }

  async execEdit() {
    // pick the model (or take it from args)
    const modelIds = Object.keys(this.engine.config.models || {});
    if (!modelIds.length) {
      logger.warn('[ModelsCommand.execEdit]', 'no models configured');
      return;
    }

    // select model to edit
    const modelId = this.args[1] || await select({
      message: 'Select model to edit:',
      choices: modelIds.map(id => ({ name: id, value: id })),
    });

    // must exist
    const current = this.engine.config.models[modelId];
    if (!current) {
      logger.error('[ModelsCommand.execEdit]', `model "${modelId}" not found in config`);
      return;
    }

    logger.log('');
    // select the model provider
    const provider = await select<Provider>({
      message: `Select provider (current: ${current.provider}):`,
      choices: PROVIDERS.map(p => ({ name: p, value: p })),
      default: current.provider,
    });
    // change the model name
    const model = (await input({ message: 'Enter model name (blank keeps current):', default: current.model })) || current.model;
    const detected = detectBaseUrl(model, provider);
    // change the model baseUrl
    const baseUrl = (await input({ message: `Enter baseUrl (blank keeps current):`, default: current.baseUrl || detected })) || current.baseUrl || detected;
    // change the model apiKey
    const apiKey = (await password({ message: 'Enter apiKey (blank keeps current):' })) || current.apiKey;
    // change the model enabled flag
    const enabled = (await confirm({ message: 'Enabled?', default: current.enabled ?? true }));
    logger.log('');

    const nextId = provider + '/' + model;
    delete this.engine.config.models[modelId];
    this.engine.config.models[nextId] = { ...current, provider, model, baseUrl, apiKey, enabled };

    // update the bound agents 
    if (nextId !== modelId) {
      for (const agent of Object.values(this.engine.config.agents || {})) {
        if (agent.model === modelId) agent.model = nextId;
      }
    }

    // save the config
    this.saveConfig();

    logger.info(`model "${nextId}" updated, config updated`);
  }

  saveConfig() {
    const cpath = join(this.engine.work, 'marvin.json');
    writeFileSync(cpath, JSON.stringify(this.engine.config, null, 2));
  }
}
