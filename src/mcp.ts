import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

import type Engine from './engine.js';
import type { Agent } from './agent.js';
import logger from './logger.js';
import { Tool } from './types.js';
import type { ToolMeta, Chat, Config } from './types.js';
import * as constants from './constants.js';
import { sanitizeToolName, tryJsonParse, withRetry } from './helpers/index.js';

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

  // shared logger (default-exported singleton from ./logger.js)
  constructor(public engine: Engine, public id: string, public config: Config['mcps'][string]) {
    logger.debug(`[Mcp.constructor]`, this.id);
  }

  get isLoaded(): boolean {
    return !!this.client;
  }

  // spawn the server process and run the initialize handshake, retrying a
  // few times. each attempt cleans up so a failure never leaves a dead
  // client behind that would make future load() calls no-op.
  async load(): Promise<void> {
    logger.debug(`[Mcp.load]`, this.id);

    if (this.client) return;

    await withRetry(async () => {
      // start clean so a previous failed attempt cannot leak into this one
      await this.drop();

      this.transport = new StdioClientTransport({
        command: this.config.command,
        args: this.config.args || [],
        env: { ...process.env, ...this.config.env } as Record<string, string>,
        stderr: 'pipe',
      });

      // drain stderr at debug level so a chatty server cannot block on a full pipe
      this.transport.stderr?.on('data', this.onStderr.bind(this));

      const client = new Client({ name: 'marvin', version: this.version() }, { capabilities: {} });
      client.onclose = this.onClose.bind(this);
      client.onerror = this.onError.bind(this);

      try {
        await client.connect(this.transport, { timeout: constants.MCP_INIT_TIMEOUT_MS });

        // const info = client.getInstructions();

        // cache the tool list, keyed by sanitized name
        const result = await client.listTools({}, { timeout: constants.MCP_CALL_TIMEOUT_MS });
        this.tools = Object.fromEntries((result.tools || []).map(t => [
          sanitizeToolName(t.name),
          {
            name: t.name,
            ...(t.description ? { description: t.description } : {}),
            inputSchema: (t.inputSchema || { type: 'object', properties: {} }) as { [key: string]: any },
          },
        ]));

        this.client = client;
      } catch (err) {
        // never leave a half-connected client behind: without this a failed
        // load would set this.client and every later load() would return early
        try { await client.close(); } catch { }
        try { await this.transport?.close(); } catch { }
        this.client = null;
        this.transport = null;
        this.tools = {};
        throw err;
      }
    }, {
      retries: constants.MCP_LOAD_RETRIES,
      delayMs: constants.MCP_LOAD_RETRY_DELAY_MS,
    });
  }

  // close the connection and kill the server process
  async drop(): Promise<void> {
    logger.debug(`[Mcp.drop]`, this.id);

    const client = this.client;
    this.client = null;
    if (client) {
      try {
        await client.close();
      } catch (err) {
        logger.error(`[Mcp.drop]`, this.id, err);
      }
    }

    const transport = this.transport;
    this.transport = null;
    this.tools = {};
    if (transport) {
      try {
        await transport.close();
      } catch (err) {
        logger.error(`[Mcp.drop]`, this.id, err);
      }
    }
  }

  // call a tool by its sanitized name, returning the flattened result content.
  async call(name: string, args: { [key: string]: any } = {}): Promise<{ schemas: {[key: string]: any}[] }> {
    logger.debug(`[Mcp.call]`, this.id, name, JSON.stringify(args).slice(0, 128));

    if (!this.client) {
      logger.warn(`[Mcp.call]`, this.id, 'not connected, reconnecting');
      await this.load();
    }

    name = this.tools[name]?.name || name;

    const result = await this.client!.callTool(
      { name: name, arguments: args },
      undefined,
      { timeout: constants.MCP_CALL_TIMEOUT_MS },
    );

    const blocks = Array.isArray(result.content) ? result.content : [];

    if (result.isError) {
      const errror = blocks.map(b => b.text).join(' | ');
      throw new Error(errror || `tool ${name}(${Object.keys(args).join(',')}) failed on "${this.id}" mpc tool call`);
    }

    const schemas: { [key: string]: any }[] = [];
    let count: number = 0;
    for (const block of blocks as { type: string, text?: string, data?: string, uri?: string }[]) {
      if (block.type === 'text' && typeof block.text === 'string') {
        // try to parse structured JSON, fall back to plain text
        let parsed = tryJsonParse(block.text);
        // must be a non-empty object
        if (parsed && typeof parsed === 'object' && Object.keys(parsed).length) {
          schemas.push(parsed);
        } else {
          schemas.push({ 'text': block.text });
        }
      } else {
        schemas.push({ [block.type]: block });
      }
      count++;
    }

    logger.debug(`[Mcp.call]`, this.id, name, count, JSON.stringify(schemas).slice(0, 128));

    return { schemas: schemas };
  }

  private onStderr(chunk: Buffer) {
    logger.debug(`[Mcp.onStderr]`, this.id, chunk.toString().trim());
  }

  private onClose() {
    logger.debug(`[Mcp.onClose]`, this.id);
    this.client = null;
  }

  private onError(err: Error) {
    logger.error(`[Mcp.onError]`, this.id, err);
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

// build a single tool meta for one mcp tool
function buildMcpToolMeta(id: string, tool: { name: string; description?: string; inputSchema: { [key: string]: any } }): ToolMeta {
  const schema = tool.inputSchema || {};
  return {
    type: 'function',
    group: id,
    function: {
      name: makeMcpToolName(id, tool.name),
      description: tool.description || `Call "${tool.name}" on the "${id}" mcp server`,
      parameters: {
        type: 'object',
        properties: schema.properties || {},
        ...(Array.isArray(schema.required) && schema.required.length ? { required: schema.required } : {}),
      },
    },
  };
}

// a single mcp server tool registered in Engine.tools: forwards calls to
// the server so execTool/load_tools use Engine.tools with no mcp special-case
export class McpTool extends Tool {
  public override readonly meta: ToolMeta;
  // raw server-side tool name (Mcp.call maps sanitized keys back to it)
  private readonly toolName: string;

  constructor(engine: Engine, public readonly mcpId: string, tool: { name: string; description?: string; inputSchema: { [key: string]: any } }) {
    super(engine);
    this.toolName = tool.name;
    this.meta = buildMcpToolMeta(mcpId, tool);
  }

  public async call(args: { [key: string]: any }, _agent?: Agent, _chat?: Chat): Promise<{ [key: string]: any }> {
    const mcp = this.engine.mcps[this.mcpId];
    if (!mcp) {
      throw new Error(`mcp "${this.mcpId}" not loaded`);
    }
    return mcp.call(this.toolName, args);
  }
}

export async function testMcp(engine: Engine, name: string, config: Config['mcps'][string]): Promise<boolean> {
  const mcp = new Mcp(engine, name, config);
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
