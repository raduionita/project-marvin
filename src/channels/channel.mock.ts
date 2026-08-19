import { Channel, Message, ChannelMeta } from '../types.js';

// Intentionally does NOT extend Channel - used to test validation in execChannels
export default class MockChannel extends Channel {
  public meta: ChannelMeta = {
    name: 'mock',
    arguments: {},
  }

  async load(): Promise<void> {
    this.logger.debug('[MockChannel.load]', 'loaded');
  }

  async sendMessage(message: Message): Promise<any> {
    this.logger.debug('[MockChannel.send]', JSON.stringify(message));
  }

  async drop(): Promise<void> {
    this.logger.debug('[MockChannel.detach]', 'dropped');
  }

  async info(): Promise<{ groups: { [key: string]: string } }> {
    this.logger.debug('[MockChannel.listGroups]', 'no groups');
    return { groups: {} };
  }
}
