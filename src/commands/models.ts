import { input, password, select } from '../terminal.js';
import { listModels } from "../models";
import { Command, Config, Provider } from "../types";
import { writeFileSync } from 'fs';
import { join } from 'path';

export default class ModelsCommand extends Command {
  async exec() {
    this.logger.debug('[ModelsCommand.exec]');

    const act = this.args[0] || 'help';
    switch (act) {
      default: 
        this.logger.warn('[ModelsCommand.exec]', 'unknown action: models', act); 
      case ''       :  
      case 'help'   : // default = empty = help 
        this.logger.info('usage: marvin models [action]');
        this.logger.info('actions:');
        this.logger.info('  help    ', 'show this help');
        this.logger.info('  list    ', 'list available models, for each one, it\'s connected agents');
        this.logger.info('  add     ', 'add a model');
        this.logger.info('  bind    ', 'bind a model to an agent');
        this.logger.info('  remove <modelId>', 'remove a model');
      break;
      case 'list' : { // list available models, for each one, it's connected agents
        this.logger.info('list models:');
        // for each model, list enabled agents
        listModels(this.engine).forEach(modelId => {
          this.logger.info(`  ${modelId}`);
          const config = this.engine.config.models[modelId];
          if (config) {
            this.logger.info('  - enabled:', config.enabled);
          }
        });
      } break;
      case 'add' : {
        const config = {} as Config['models'][string];
        
        this.logger.log('');
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
        this.logger.log('');
        
        if (!config['baseUrl']) delete config['baseUrl'];
        config['enabled'] = true;

        const modelId = config['provider'] + '/' + config['model'];

        this.engine.config.models[modelId] = config;

        const cpath = join(this.engine.work, 'marvin.json');
        // write to config file
        if (this.engine.isDry) {
          this.logger.info('[ModelsCommand.exec]', '[dry]',`would configure model "${modelId}", config persisted to ${cpath}`);
        } else {
          writeFileSync(cpath, JSON.stringify(this.engine.config, null, 2));
          this.logger.info('[ModelsCommand.exec]', `model "${modelId}" configured, config persisted to ${cpath}`);
        }
      } break;
    }
  }
}
