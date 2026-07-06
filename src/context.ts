import * as http from 'http';
import { type Browser } from 'playwright';
import { type Config, type Model, type Channel, type Tool, type Agent } from './types.js';
import { type Server } from './server.js';
import { type Client } from './client.js';

export class Context {
  public state: 'running' | 'reloading' | 'stopped' = 'running';
  
  public server?: Server;
  public client?: Client;

  public config: Config = {} as Config;
  public browser: Browser | null = null;
  public http: http.Server | undefined;

  // TODO: later consider moving browser, http, watch (file watcher) to a separate group "systems"
  public systems: Record<string, any> = {};

  // channels, models, agents
  public channels: Record<string, Channel> = {};
  public tools   : Record<string, Tool> = {};
  public models  : Record<string, Model> = {};
  public agents  : Record<string, Agent> = {};

  // home (~/.marvin) data folder
  public home: string = '';
  // root (~/) app folder 
  public root: string = '';

  public isDry: boolean = process.argv.includes('--dry');
  public isTest: boolean = process.env.NODE_ENV === 'test' || process.env.BUN_TEST === '1';
}
