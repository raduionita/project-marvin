import { input, password, select } from '../terminal.js';
import { listModels } from "../models";
import { Command, Config, Provider } from "../types";
import { writeFileSync } from 'fs';
import { join } from 'path';
import logger from '../logger.js';

export default class ModelsCommand extends Command {
  async exec() {
    logger.debug('[ModelsCommand.exec]');

    const act = this.args[0] || 'help';
    switch (act) {
      default: 
        logger.warn('[ModelsCommand.exec]', 'unknown action: models', act); 
      case ''       :  
      case 'help'   : // default = empty = help 
        logger.info('usage: marvin models [action]');
        logger.info('actions:');
        logger.info('  help    ', 'show this help');
        logger.info('  list    ', 'list available models, for each one, it\'s connected agents');
        logger.info('  add     ', 'add a model');
        logger.info('  bind    ', 'bind a model to an agent');
        logger.info('  remove <modelId>', 'remove a model');
      break;
      case 'list' : { // list available models, for each one, it's connected agents
        logger.info('list models:');
        // for each model, list enabled agents
        listModels(this.engine).forEach(modelId => {
          logger.info(`  ${modelId}`);
          const config = this.engine.config.models[modelId];
          if (config) {
            logger.info('  - enabled:', config.enabled);
          }
        });
      } break;
      case 'add' : {
        const config = {} as Config['models'][string];
        
        logger.log('');
        config['provider'] = await select<Provider>({
          message: 'Select provider:',
          choices: [
            { name: 'openai', value: 'openai' },
            { name: 'anthropic', value: 'anthropic' },
            { name: 'deepseek', value: 'deepseek' },
            { name: 'lmstudio', value: 'lmstudio' },
          ],
          default: 'openai',
        });
        config['model']    = await input({ message: 'Enter model name (e.g. gpt-3.5-turbo):', required: true });
        config['baseUrl']  = await input({ message: 'Enter baseUrl (e.g. http://localhost:1234):' });
        config['apiKey']   = await password({ message: 'Enter apiKey (e.g. sk-1234):' });
        logger.log('');
        
        if (!config['baseUrl']) delete config['baseUrl'];
        config['enabled'] = true;

        const modelId = config['provider'] + '/' + config['model'];

        this.engine.config.models[modelId] = config;

        const cpath = join(this.engine.work, 'marvin.json');
        // write to config file
        writeFileSync(cpath, JSON.stringify(this.engine.config, null, 2));
        logger.info(`model "${modelId}" configured, config persisted to ${cpath}`);
      } break;
    }
  }
}
