import * as http from 'http';

import { System } from '../types.js';
import * as constants from '../constants.js';
import ServeCommand from '../commands/serve.js';

export default class ApiSystem extends System {
  private port: number = 7331;
  private host: string = '127.0.0.1';
  private server: http.Server | undefined;

  public async load(): Promise<void> {
    console.debug('[ApiSystem.load]');

    this.port = this.ctx.config.settings.port || 7331;
    this.host = this.ctx.config.settings.host || '127.0.0.1';

    if (this.ctx.isDry) {
      console.info('[ApiSystem.load]', '[dry] loading server', this.host, this.port);
      return;
    }

    this.server = http.createServer(async (req, res) => {
      const url = new URL(req.url || '/', `http://localhost:${this.port}`);
      const command = url.pathname.split('/')[1];

      if (!command) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'No command provided' }));
        return;
      }

      // skip auth for health check
      if (command === '_health') {
        await this.handleHealth(req, res);
        return;
      }

      // verify apiToken (if configured)
      if (!this.isAuth(url, req.headers)) {
        this.handleNoAuth(res);
        return;
      }

      console.debug('[ApiSystem.load]', `command: ${command}`);

      try {
        switch (command) {
          case 'reload':
            await this.handleReload(req, res);
            break;
          case 'status':
            await this.handleStatus(req, res);
            break;
          case 'chat':
            await this.handleChat(req, res);
            break;
          default:
            await this.handleUnknown(req, res);
            return;
        }
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: (err as Error).message }));
      }
    });

    this.server.on('error', this.handleError.bind(this));

    await this.listen();
  }

  public drop(): Promise<void> {
    console.debug('[ApiSystem.drop]');

    return new Promise<void>((resolve) => {
      if (this.server) {
        this.server.close(function (error?: Error|undefined) {
          if (error) {
            console.error('[ApiSystem.drop]', 'error:', error);
          } else {
            console.log('[ApiSystem.drop]', 'closed');
          }
          resolve();
        });
        this.server = undefined;
      } else {
        console.log('[ApiSystem.drop]', 'already closed');
        resolve();
      }
    });
  }

  private async listen() {
    console.debug('[ApiSystem.listen]');

    return new Promise<void>((resolve) => {
      this.server!.listen(this.port, this.host, () => {
        console.log(`[marvin] API server listening on port ${this.port}`);
        resolve();
      });
    });
  }

  private isAuth(url: URL, headers: http.IncomingMessage['headers']) {
    const token = this.ctx.config.settings.apiToken;
    if (token && token !== 'changeme') {
      const authHeader = headers['authorization'] || '';
      const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
      const queryToken = url.searchParams.get('token');
      const provided = bearer || queryToken;
      if (provided === token) {
        return true;
      }
    }
    return false;
  }

  private handleNoAuth(res: http.ServerResponse) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'Unauthorized' }));
  }

  private async handleError(err: Error) {
    console.error('[ApiSystem.load]', 'error:', err);
  }

  private async handleHealth(req: http.IncomingMessage, res: http.ServerResponse) {
    console.debug('[ApiSystem.handleHealth]');

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, data: {} }));
  }

  private async handleStatus(req: http.IncomingMessage, res: http.ServerResponse) {
    console.debug('[ApiSystem.handleStatus]');

    // TODO: add more info: models, channels, agents, tools
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, data: { state: this.ctx.state } }));
  }

  private async handleReload(req: http.IncomingMessage, res: http.ServerResponse) {
    console.debug('[ApiSystem.handleReload]');
    const cmd = this.ctx.command as ServeCommand;
    cmd.execReload();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, data: {} }));
  }

  private async handleChat(req: http.IncomingMessage, res: http.ServerResponse) {
    console.debug('[ApiSystem.handleChat]', 'body:', req.url);
    
    const ctx = this.ctx;

    try {
      // read body as JSON
      const body = await new Promise<{[key: string]: any}>((resolve, reject) => {
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', () => {
          try {
            const raw = Buffer.concat(chunks).toString('utf8');
            resolve(raw ? JSON.parse(raw) : null);
          } catch (err) {
            reject(err);
          }
        });
        req.on('error', reject);
      });
      
      if (!body.message) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Missing "message" in body' }));
        return;
      }
      
      const message = body.message as string;
      const chatId = body.chatId || `http-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const agentId = (body.agentId as string) || ctx.config.settings.name; // default to marvin (orchestrator)
      const maxSteps = (body.maxSteps as number) ?? constants.DEFAULT_MAX_STEPS;

      const serve = this.ctx.command as ServeCommand;
      if (!serve) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: '(ServeCommand.sendMessage ERROR - server not available)' }));
        return;
      }

      // send message to the LLM
      const result = await serve.sendMessage(ctx, message, chatId, agentId, maxSteps);
      if (!result) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: '(ServeCommand.sendMessage ERROR - no LLM result)' }));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        data: {
          content: result.content,
          steps: result.steps,
          agentId: agentId,
          chatId: chatId,
        },
      }));
    } catch (err) {
      console.error('[ApiSystem.handleChat]', 'error:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: (err as Error).message }));
    }
  }

  private async handleUnknown(req: http.IncomingMessage, res: http.ServerResponse) {
    console.debug('[ApiSystem.handleUnknown]');

    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'Unknown command' }));
  }
}
