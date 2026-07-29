import readline from 'readline';

import { listModels } from "../models";
import { Command, Config, Provider } from "../types";
import { writeFileSync } from 'fs';
import { join } from 'path';

export default class ModelsCommand extends Command {
  async exec() {
    console.debug('[ModelsCommand.exec]');

    const cmds = process.argv.slice(2);
    const cmd = cmds[1] || 'help';

    switch (cmd) {
      default: 
        console.warn('[ModelsCommand.exec]', 'unknown command: models', cmd); 
      case ''       :  
      case 'help'   : // default = empty = help 
        console.log('[ModelsCommand.exec]', 'usage: marvin models [command]');
        console.log('[ModelsCommand.exec]', 'commands:');
        console.log('[ModelsCommand.exec]', '  help    ', 'show this help');
        console.log('[ModelsCommand.exec]', '  list    ', 'list available models, for each one, it\'s connected agents');
        console.log('[ModelsCommand.exec]', '  add     ', 'add a model');
        console.log('[ModelsCommand.exec]', '  bind    ', 'bind a model to an agent');
        console.log('[ModelsCommand.exec]', '  remove <modelId>', 'remove a model');
      break;
      case 'list' : { // list available models, for each one, it's connected agents
        console.log('[ModelsCommand.exec]', 'list models:');
        // for each model, list enabled agents
        listModels(this.ctx!).forEach(modelId => {
          console.debug('[ModelsCommand.exec]', `  ${modelId.replace('.ts', '')}`);
          const config = this.ctx.config.models[modelId];
          if (config) {
            console.log('[ModelsCommand.exec]', '    enabled:', config.enabled);
          }
        });
      } break;
      case 'add' : {
        const config = {} as Config['models'][string];
        // ask for provder
        const rl = readline.createInterface({input: process.stdin, output: process.stdout});
        config['provider'] = await new Promise<Provider>((resolve) => {
          rl.question('Enter provider [openai, anthropic, deepseek, lmstudio]: ', (ans: string) => {
            resolve(ans as Provider);
            rl.close();
          });
        });
        // ask for model
        config['model'] = await new Promise<string>((resolve) => {
          rl.question('Enter model (e.g. gpt-3.5-turbo): ', (ans: string) => {
            resolve(ans);
            rl.close();
          });
        });
        // ask for baseUrl or empty/default
        config['baseUrl'] = await new Promise<string>((resolve) => {
          rl.question('Enter baseUrl (e.g. http://localhost:1234): ', (ans: string) => {
            resolve(ans);
            rl.close();
          });
        });
        if (!config['baseUrl']) delete config['baseUrl'];
        // ask for apiKey or empty/default
        config['apiKey'] = await new Promise<string>((resolve) => {
          rl.question('Enter apiKey (e.g. sk-1234): ', (ans: string) => {
            resolve(ans);
            rl.close();
          });
        });

        config['enabled'] = true;

        const id = config['provider'] + '/' + config['model'];

        this.ctx.config.models[id] = config;

        const cpath = join(this.ctx.home, 'marvin.json');
        // write to config file
        if (this.ctx.isDry) {
          console.info('[ModelsCommand.exec]', '[dry]',`would configure model ${id}, config persisted to ${cpath}`);
        } else {
          writeFileSync(cpath, JSON.stringify(this.ctx.config, null, 2));
          console.info('[ModelsCommand.exec]', `model "${id}" configured, config persisted to ${cpath}`);
        }
      } break;
    }
  }
}
