import { Channel, Message, ChannelMeta } from '../types.js';
import logger from '../logger.js';

// Intentionally does NOT extend Channel - used to test validation in execChannels
export default class MockChannel extends Channel {
  public meta: ChannelMeta = {
    name: 'mock',
    arguments: {},
  }

  async load(): Promise<void> {
    logger.debug('[MockChannel.load]', 'loaded');
  }

  async sendMessage(message: Message): Promise<any> {
    logger.debug('[MockChannel.send]', JSON.stringify(message));
  }

  async drop(): Promise<void> {
    logger.debug('[MockChannel.detach]', 'dropped');
  }

  async info(): Promise<{ groups: { [key: string]: string } }> {
    logger.debug('[MockChannel.listGroups]', 'no groups');
    return { groups: {} };
  }
}
