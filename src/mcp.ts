import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

import type Engine from './engine.js';
import type { Logger } from './logger.js';
import type { ToolMeta, Config } from './types.js';
import * as constants from './constants.js';
import { sanitizeToolName, flattenContent } from './helpers.js';

// client for one mcp server over stdio: spawns the process on load, lists its
// tools and forwards tool calls. reconnects lazily if the process died.
export class Mcp {
  public client: Client | null = null;
  public transport: StdioClientTransport | null = null;
  // tools as listed on load, keyed by sanitized name
  public tools: Record<string, {
    name: string;
    description?: string;
    inputSchema: { [key: string]: any };
  }> = {};

  constructor(public engine: Engine, public logger: Logger, public id: string, public config: Config['mcps'][string]) {
    this.logger.debug(`[Mcp.constructor]`, this.id);
  }

  get isLoaded(): boolean {
    return !!this.client;
  }

  // spawn the server process and run the initialize handshake
  async load(): Promise<void> {
    this.logger.debug(`[Mcp.load]`, this.id);

    if (this.client) return;

    this.transport = new StdioClientTransport({
      command: this.config.command,
      args: this.config.args || [],
      env: { ...process.env, ...this.config.env } as Record<string, string>,
      stderr: 'pipe',
    });

    // drain stderr at debug level so a chatty server cannot block on a full pipe
    this.transport.stderr?.on('data', this.onStderr.bind(this));

    this.client = new Client({ name: 'marvin', version: this.version() }, { capabilities: {} });
    this.client.onclose = this.onClose.bind(this);
    this.client.onerror = this.onError.bind(this);

    await this.client.connect(this.transport, { timeout: constants.MCP_INIT_TIMEOUT_MS });

    // cache the tool list, keyed by sanitized name
    const result = await this.client.listTools({}, { timeout: constants.MCP_CALL_TIMEOUT_MS });
    this.tools = Object.fromEntries((result.tools || []).map(t => [
      sanitizeToolName(t.name),
      {
        name: t.name,
        ...(t.description ? { description: t.description } : {}),
        inputSchema: (t.inputSchema || { type: 'object', properties: {} }) as { [key: string]: any },
      },
    ]));

    this.logger.info(`[Mcp.call]`, this.id, `connected, ${Object.keys(this.tools).length} tool(s)`);
  }

  // close the connection and kill the server process
  async drop(): Promise<void> {
    this.logger.debug(`[Mcp.drop]`, this.id);

    const client = this.client;
    this.client = null;
    if (client) {
      try {
        await client.close();
      } catch (err) {
        this.logger.error(`[Mcp.drop]`, this.id, err);
      }
    }

    const transport = this.transport;
    this.transport = null;
    this.tools = {};
    if (transport) {
      try {
        await transport.close();
      } catch (err) {
        this.logger.error(`[Mcp.drop]`, this.id, err);
      }
    }
  }

  // call a tool by its sanitized name, returning the flattened result content.
  async call(name: string, args: { [key: string]: any } = {}): Promise<{ [key: string]: any }> {
    this.logger.debug(`[Mcp.call]`, this.id, name);

    if (!this.client) {
      this.logger.warn(`[Mcp.call]`, this.id, 'not connected, reconnecting');
      await this.load();
    }

    const raw = this.tools[name]?.name || name;

    const result = await this.client!.callTool(
      { name: raw, arguments: args },
      undefined,
      { timeout: constants.MCP_CALL_TIMEOUT_MS },
    );

    const flat = flattenContent(result.content);
    
    // in-band errors (isError=true) surface as thrown errors for the ai loop
    if (result.isError) {
      throw new Error(flat.text || `tool ${raw} failed on mcp "${this.id}"`);
    }

    return flat;
  }

  private onStderr(chunk: Buffer) {
    this.logger.debug(`[Mcp.onStderr]`, this.id, chunk.toString().trim());
  }

  private onClose() {
    this.logger.debug(`[Mcp.onClose]`, this.id);
    this.client = null;
  }

  private onError(err: Error) {
    this.logger.error(`[Mcp.onError]`, this.id, err);
  }

  // marvin version from the app package.json (fallback "0.0.0")
  private version(): string {
    try {
      const pkgPath = join(this.engine.root, 'package.json');
      if (existsSync(pkgPath)) {
        return JSON.parse(readFileSync(pkgPath, 'utf8')).version || '0.0.0';
      }
    } catch {
      // fall through
    }
    return '0.0.0';
  }
}

// mcp tool names follow `<mcpId>__<toolName>`
export function makeMcpToolName(mcp: string, tool: string): string {
  return `${mcp}__${sanitizeToolName(tool)}`;
}

// build the tool metas for a task's linked mcps. loaded dynamically at
// execTask time and merged with the engine (default) tools. ensures each
// client is connected so its cached tool list is fresh.
export async function loadMcpTools(engine: Engine, mcps: string[]): Promise<ToolMeta[]> {
  const tools: ToolMeta[] = [];
  for (const id of mcps || []) {
    const client = engine.mcps[id];
    if (!client) {
      engine.logger.warn('[loadMcpTools]', `mcp "${id}" not loaded, skipping`);
      continue;
    }

    try {
      if (!client.isLoaded) await client.load();
    } catch (err) {
      engine.logger.warn('[loadMcpTools]', `mcp "${id}" failed to connect:`, (err as Error).message);
      continue;
    }

    for (const tool of Object.values(client.tools)) {
      const schema = tool.inputSchema || {};
      tools.push({
        type: 'function',
        function: {
          name: makeMcpToolName(id, tool.name),
          description: tool.description || `Call "${tool.name}" on the "${id}" mcp server`,
          parameters: {
            type: 'object',
            properties: schema.properties || {},
            ...(Array.isArray(schema.required) && schema.required.length ? { required: schema.required } : {}),
          },
        },
      });
    }
  }
  return tools;
}

export async function testMcp(engine: Engine, name: string, config: Config['mcps'][string]): Promise<boolean> {
  const mcp = new Mcp(engine, engine.logger, name, config);
  try {
    await mcp.load();
    return true;
  } catch (err) {
    return false;
  } finally {
    await mcp.drop();
  }
}

// unwrap common paste formats down to the server spec, then validate it:
// - claude-style wrapper: { "mcpServers": { "<name>": {...} } }
// - bare named server:    { "<name>": { "command": ... } }
// - direct spec:          { "command": ..., "args": [...], "env": {...} }
// returns the spawn config, or null when the snippet is invalid
export function specMcp(json: {[key:string]:any}): Config['mcps'][string] | null {
  let spec: { [key: string]: any } = json;
  if (json && typeof json === 'object' && !Array.isArray(json) && json.mcpServers && typeof json.mcpServers === 'object') {
    const entries = Object.entries(json.mcpServers);
    if (entries.length) spec = entries[0]![1] as { [key: string]: any };
  } else if (json && typeof json === 'object' && !Array.isArray(json)) {
    const keys = Object.keys(json);
    if (keys.length === 1) {
      const value = (json as { [key: string]: any })[keys[0]!];
      if (value && typeof value === 'object' && !Array.isArray(value) && value.command) spec = value;
    }
  }

  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) return null;
  if (typeof spec.command !== 'string' || !spec.command.trim()) return null;
  if (spec.args !== undefined && (!Array.isArray(spec.args) || spec.args.some((a: any) => typeof a !== 'string'))) return null;
  if (spec.env !== undefined && (!spec.env || typeof spec.env !== 'object' || Array.isArray(spec.env) || Object.values(spec.env).some((v: any) => typeof v !== 'string'))) return null;

  const config: Config['mcps'][string] = {
    ...(spec.enabled === undefined ? {} : { enabled: !!spec.enabled }),
    command: spec.command.trim(),
    args: spec.args || [],
    ...(spec.env ? { env: spec.env } : {}),
  };
  return config;
}
