import { promises } from 'readline';

import { listModels } from "../models";
import { Command, Config, Provider } from "../types";
import { writeFileSync } from 'fs';
import { join } from 'path';

export default class ModelsCommand extends Command {
  async exec() {
    console.debug('[ModelsCommand.exec]');

    const act = this.args[0] || 'help';
    switch (act) {
      default: 
        console.warn('[ModelsCommand.exec]', 'unknown action: models', act); 
      case ''       :  
      case 'help'   : // default = empty = help 
        console.info('usage: marvin models [action]');
        console.info('actions:');
        console.info('  help    ', 'show this help');
        console.info('  list    ', 'list available models, for each one, it\'s connected agents');
        console.info('  add     ', 'add a model');
        console.info('  bind    ', 'bind a model to an agent');
        console.info('  remove <modelId>', 'remove a model');
      break;
      case 'list' : { // list available models, for each one, it's connected agents
        console.info('list models:');
        // for each model, list enabled agents
        listModels(this.engine!).forEach(modelId => {
          console.info(`  ${modelId.replace('.ts', '')}`);
          const config = this.engine.config.models[modelId];
          if (config) {
            console.info('  - enabled:', config.enabled);
          }
        });
      } break;
      case 'add' : {
        const config = {} as Config['models'][string];
        
        console.log('');
        const pli = promises.createInterface({input: process.stdin, output: process.stdout, });
        config['provider'] = await pli.question('Enter provider [openai, anthropic, deepseek, lmstudio]: ') as Provider;
        config['model']    = await pli.question('Enter model name (e.g. gpt-3.5-turbo): ');
        config['baseUrl']  = await pli.question('Enter baseUrl (e.g. http://localhost:1234): ');
        config['apiKey']   = await pli.question('Enter apiKey (e.g. sk-1234): ');
        pli.close();
        console.log('');
        
        if (!config['baseUrl']) delete config['baseUrl'];
        config['enabled'] = true;

        const modelId = config['provider'] + '/' + config['model'];

        this.engine.config.models[modelId] = config;

        const cpath = join(this.engine.home, 'marvin.json');
        // write to config file
        if (this.engine.isDry) {
          console.info('[ModelsCommand.exec]', '[dry]',`would configure model "${modelId}", config persisted to ${cpath}`);
        } else {
          writeFileSync(cpath, JSON.stringify(this.engine.config, null, 2));
          console.info('[ModelsCommand.exec]', `model "${modelId}" configured, config persisted to ${cpath}`);
        }
      } break;
    }
  }
}
