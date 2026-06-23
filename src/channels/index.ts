import { Context } from '../context.js';
import { Channel } from '../types.js';
import SlackChannel from './slack.js';

export const channelsRegistry = new Map<string, new (ctx: any) => Channel>();

export async function loadChannels(ctx: Context) {
  console.log('[Channels] Loading channels from registry...');

  // Register the class
  channelsRegistry.set('slack', SlackChannel);

  for (const [id, channelConfig] of Object.entries(ctx.config.channels)) {
    if (!channelConfig.enabled) continue;

    const ChannelClass = channelsRegistry.get(id);
    if (!ChannelClass) {
      console.warn(`[Channels] No channel class found for: ${id}`);
      continue;
    }

    try {
      const instance = new ChannelClass(ctx);
      await instance.attach(channelConfig);
      ctx.channels.set(id, instance);
      console.log(`[Channels] Instance created: ${id}`);
    } catch (err) {
      console.error(`[Channels] Failed to instantiate ${id}:`, err);
    }
  }

  console.log(`[Channels] Total loaded: ${ctx.channels.size}`);
}
