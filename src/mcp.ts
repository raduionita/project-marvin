import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

import type Engine from './engine.js';
import type { Logger } from './logger.js';
import type { ToolMeta } from './types.js';
import * as constants from './constants.js';

// mcp connector config (marvin.json mcps[id]): a stdio server spawn spec
export interface McpConfig {
  enabled?: boolean;
  command: string;
  args: string[];
  env?: Record<string, string>;
}

// mcp tool as exposed by a server (subset used by marvin)
export interface McpTool {
  name: string;
  description?: string;
  inputSchema: { [key: string]: any };
}

// client for one mcp server over stdio: spawns the process on load, lists its
// tools and forwards tool calls. reconnects lazily if the process died.
export class Mcp {
  public client: Client | null = null;
  public transport: StdioClientTransport | null = null;
  // tools as listed on load (used for prompt blocks and tool metas)
  public tools: McpTool[] = [];
  // sanitized -> raw tool names (llm function names must be [a-zA-Z0-9_-])
  public toolNames: Record<string, string> = {};

  constructor(public engine: Engine, public logger: Logger, public id: string, public config: McpConfig) {
    this.logger.debug(`[Mcp.${this.id}.constructor]`);
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

    // cache the tool list + sanitized name mapping
    const listed = await this.client.listTools({}, { timeout: constants.MCP_CALL_TIMEOUT_MS });
    this.tools = (listed.tools || []).map(t => ({
      name: t.name,
      ...(t.description ? { description: t.description } : {}),
      inputSchema: (t.inputSchema || { type: 'object', properties: {} }) as { [key: string]: any },
    }));

    this.toolNames = Object.fromEntries(this.tools.map(t => [sanitizeToolName(t.name), t.name]));

    this.logger.info(`[Mcp.${this.id}]`, `connected, ${this.tools.length} tool(s)`);
  }

  // close the connection and kill the server process
  async drop(): Promise<void> {
    this.logger.debug(`[Mcp.${this.id}.drop]`);

    const client = this.client;
    this.client = null;
    if (client) {
      try {
        await client.close();
      } catch (err) {
        this.logger.error(`[Mcp.${this.id}.drop]`, err);
      }
    }

    const transport = this.transport;
    this.transport = null;
    this.tools = [];
    this.toolNames = {};
    if (transport) {
      try {
        await transport.close();
      } catch (err) {
        this.logger.error(`[Mcp.${this.id}.drop]`, err);
      }
    }
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

  // call a tool by its sanitized name, returning the flattened result content.
  // reconnects once when the server process is gone.
  async execTool(name: string, args: { [key: string]: any } = {}): Promise<{ [key: string]: any }> {
    this.logger.debug(`[Mcp.${this.id}.callTool]`, name);

    if (!this.client) {
      this.logger.warn(`[Mcp.${this.id}]`, 'not connected, reconnecting');
      await this.load();
    }

    const raw = this.toolNames[name] || name;

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

// llm function names must match ^[a-zA-Z0-9_-]+$: map anything else to _
export function sanitizeToolName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_');
}

// flatten mcp result content blocks into a plain object: text blocks join into
// .text, other block types (image, audio, resource) are kept under their type
function flattenContent(content: unknown): { [key: string]: any } {
  const out: { [key: string]: any } = {};
  const texts: string[] = [];
  for (const block of (Array.isArray(content) ? content : []) as { type: string, text?: string }[]) {
    if (block.type === 'text' && typeof block.text === 'string') {
      texts.push(block.text);
    } else {
      (out[block.type] ||= []).push(block);
    }
  }
  if (texts.length) out.text = texts.join('\n');
  return out;
}

// --- per-task mcp tools (linked to tasks via task.mcps) ---

// mcp tool names follow `<mcpId>__<toolName>` (double underscore, same
// convention as integration tools, since both ids and tool names may contain
// single underscores)
export function mcpToolName(mcpId: string, toolName: string): string {
  return `${mcpId}__${sanitizeToolName(toolName)}`;
}

// split a tool name back into { mcpId, toolName }, or null when the name is
// not an mcp tool
export function splitMcpToolName(name: string): { mcpId: string, toolName: string } | null {
  const idx = name.lastIndexOf('__');
  if (idx <= 0 || idx === name.length - 2) return null;
  return { mcpId: name.slice(0, idx), toolName: name.slice(idx + 2) };
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

    for (const tool of client.tools) {
      const schema = tool.inputSchema || {};
      tools.push({
        type: 'function',
        function: {
          name: mcpToolName(id, tool.name),
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
