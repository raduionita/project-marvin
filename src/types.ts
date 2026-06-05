export interface Config {
  
}

export interface Plugin {
  attach(settings?: Record<string, any>) : Promise<any>;
  detach(): void;
}
