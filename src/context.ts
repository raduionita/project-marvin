import { Browser } from 'playwright';
import { Config, Model, Channel, Tool, Agent } from './types.js';

let ctx: Context | null; 

export class Context {
  public config: Config = {} as Config;
  public browser: Browser | null = null;

  public channels = new Map<string, Channel>();
  public models = new Map<string, Model>();
  public agents = new Map<string, Agent>();

  public wdir: string = '';
}

export function loadContext() : Context {
  if (ctx) return ctx;
  ctx = new Context();
  return ctx;
}
