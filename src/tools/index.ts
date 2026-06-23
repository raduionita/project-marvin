import { Context } from '../context.js';
import { Tool } from '../types.js';

import GetDateTool from './getDate.js';
import WebBrowseTool from './webBrowse.js';
import WebSearchTool from './webSearch.js';

export const toolsRegistry = new Map<string, new (ctx: any) => Tool>();

export { GetDateTool, WebBrowseTool, WebSearchTool };

export async function execTool(ctx: Context, tool: string, args: any) {
  const ToolClass = toolsRegistry.get(tool);
  if (!ToolClass) {
    throw new Error(`Tool ${tool} not found`);
  }
  const toolInstance = new ToolClass(ctx);
  return await toolInstance.call(null, args);
}
