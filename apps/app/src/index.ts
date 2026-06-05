import { type Plugin } from '@marvin/core';

process.on('unhandledRejection', (reason, p) => {
  console.error('Unhandled Rejection at: Promise', p, 'reason:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

process.on('SIGINT', () => {
  console.log('Received SIGINT. Exiting...');
  process.exit(0);
});

async function loadPlugin(name:string): Promise<Plugin> {
  const plugin = await import(`../../../pkgs/${name}/out/index.js`);
  return plugin.default as Plugin;
}

(async () => {
  const mock = await loadPlugin('mock');

  console.log(mock);

  mock.attach();
  mock.detach();
})();
