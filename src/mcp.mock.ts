// minimal stdio mcp server used by tests (run with bun): speaks enough
// json-rpc 2.0 for initialize, tools/list and tools/call
import { createInterface } from 'readline';

const rl = createInterface({ input: process.stdin });

function write(msg: any) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

rl.on('line', (line) => {
  let msg: any;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  if (!msg || msg.jsonrpc !== '2.0') return;

  // notifications get no response (e.g. notifications/initialized)
  if (msg.id === undefined || msg.id === null) return;

  switch (msg.method) {
    case 'initialize':
      write({
        jsonrpc: '2.0',
        id: msg.id,
        result: {
          protocolVersion: msg.params?.protocolVersion || '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'mock-mcp', version: '1.0.0' },
        },
      });
      break;

    case 'tools/list':
      write({
        jsonrpc: '2.0',
        id: msg.id,
        result: {
          tools: [
            {
              name: 'echo',
              description: 'Echo the input text',
              inputSchema: {
                type: 'object',
                properties: { text: { type: 'string', description: 'text to echo' } },
                required: ['text'],
              },
            },
            {
              name: 'peek_env',
              description: 'Return MOCK_MCP_TOKEN from the server environment',
              inputSchema: { type: 'object', properties: {} },
            },
            {
              name: 'weird.name',
              description: 'Tool name that needs sanitization',
              inputSchema: { type: 'object', properties: {} },
            },
          ],
        },
      });
      break;

    case 'tools/call': {
      const name = msg.params?.name;
      if (name === 'echo') {
        write({
          jsonrpc: '2.0',
          id: msg.id,
          result: { content: [{ type: 'text', text: `echo: ${msg.params.arguments?.text}` }] },
        });
      } else if (name === 'peek_env') {
        write({
          jsonrpc: '2.0',
          id: msg.id,
          result: { content: [{ type: 'text', text: `MOCK_MCP_TOKEN=${process.env.MOCK_MCP_TOKEN ?? ''}` }] },
        });
      } else if (name === 'fail') {
        write({
          jsonrpc: '2.0',
          id: msg.id,
          result: { content: [{ type: 'text', text: 'boom' }], isError: true },
        });
      } else {
        write({
          jsonrpc: '2.0',
          id: msg.id,
          error: { code: -32602, message: `unknown tool: ${name}` },
        });
      }
      break;
    }

    default:
      write({
        jsonrpc: '2.0',
        id: msg.id,
        error: { code: -32601, message: `method not found: ${msg.method}` },
      });
  }
});
