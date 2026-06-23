import { Browser } from 'playwright';
import { Config, Model, Channel, Tool, Agent } from './types.js';

let ctx: Context | null; 

export class Context {
  public running = true;
  public config: Config = {} as Config;
  public browser: Browser | null = null;

  public tools   : Record<string, Tool> = {};
  public channels: Record<string, Channel> = {};
  public models  : Record<string, Model> = {};
  public agents  : Record<string, Agent> = {};

  public wdir: string = '';
}

export function loadContext() : Context {
  if (ctx) return ctx;
  ctx = new Context();
  return ctx;
}
