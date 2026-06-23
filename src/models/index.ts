import { Context } from '../context.js';
import { Model, Config } from '../types.js';

type ModelConfig = Config['models'][string];

export async function loadModel(config: ModelConfig) : Promise<Model> {
  console.log('[marvin] model:', config.provider, config.model, 'loading...') ;

  // import class dynamically
  const ModelClass = await import(`./${config.provider}.js`);

  // create instance
  const instance = new ModelClass(config);

  console.log('[marvin] model:', config.model, 'loaded!');

  return instance;
}
