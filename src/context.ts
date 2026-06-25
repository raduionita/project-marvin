import * as http from 'http';
import { Browser } from 'playwright';
import { Config, Model, Channel, Tool, Agent } from './types.js';

let ctx: Context | null; 

export class Context {
  public state: 'running' | 'reloading' | 'stopped' = 'running';
  
  public config: Config = {} as Config;
  public browser: Browser | null = null;
  public server: http.Server | undefined;

  public tools   : Record<string, Tool> = {};
  public channels: Record<string, Channel> = {};
  public models  : Record<string, Model> = {};
  public agents  : Record<string, Agent> = {};

  public wdir: string = '';

  public readonly isTest: boolean = process.env.NODE_ENV === 'test' || process.env.BUN_TEST === '1';
}

export function loadContext() : Context {
  if (ctx) return ctx;
  ctx = new Context();
  return ctx;
}
