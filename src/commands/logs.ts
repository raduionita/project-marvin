import { existsSync, readFileSync, statSync, openSync, readSync, closeSync, writeFileSync } from 'fs';
import { join } from 'path';
import { Command } from "../types";
import { delay } from '../helpers';
import logger from '../logger.js';

// `marvin logs [-f|--follow] [-n|--lines <n>]` tail the daemon log file
// `marvin logs clear` clears the log file, `marvin logs help` shows help
export default class LogsCommand extends Command {
  async exec() {
    logger.debug('[LogsCommand.exec]', this.args);

    const cmd = this.args[0] || '';
    switch (cmd) {
      case 'clear':
        await this.execClear();
        break;
      case 'help':
        await this.execHelp();
        break;
      case '':
        await this.execLog();
        break;
      default:
        // also handle flags as default log view: `marvin logs -n 2`, `marvin logs -f`
        if (cmd.startsWith('-')) {
          await this.execLog();
          break;
        }
        logger.warn('[LogsCommand.exec]', 'unknown command: logs', cmd);
        await this.execHelp();
        break;
    }
  }

  async execHelp() {
    logger.info('usage: marvin logs [command] [-f|--follow] [-n|--lines <n>]');
    logger.info('commands:');
    logger.info('  help                 ', 'show this help');
    logger.info('  clear                ', 'clear the daemon log file');
    logger.info('  (default)            ', 'tail the daemon log file [-f|--follow] [-n|--lines <n>]');
  }

  async execClear() {
    logger.debug('[LogsCommand.execClear]');

    const lpath = join(this.engine.work, 'logs', 'marvin.log');
    if (!existsSync(lpath)) {
      logger.warn('[LogsCommand.execClear]', 'no log file found at', lpath);
      return;
    }

    writeFileSync(lpath, '');
    logger.info('log file cleared:', lpath);
  }

  async execLog() {
    logger.debug('[LogsCommand.execLog]');

    const lpath = join(this.engine.work, 'logs', 'marvin.log');
    if (!existsSync(lpath)) {
      logger.error('[LogsCommand.execLog]', 'no log file found at', lpath, 'run "marvin enable" first');
      return;
    }

    const follow = this.args.includes('-f') || this.args.includes('--follow');
    if (follow) {
      logger.warn('following', lpath, '(ctrl+c to stop)');
    }

    const lines = this.parseLines();

    // print the last `lines` lines of the file
    const tail = this.readTail(lpath, lines);
    for (const line of tail) {
      logger.log(line);
    }

    if (!follow) {
      return;
    }

    // follow mode: stream newly appended lines, one poll per second
    let offset = statSync(lpath).size;
    while (true) {
      await delay(1000);
      const size = statSync(lpath).size;
      if (size > offset) {
        const fd = openSync(lpath, 'r');
        const buf = Buffer.alloc(size - offset);
        readSync(fd, buf, 0, buf.length, offset);
        closeSync(fd);
        process.stdout.write(buf.toString('utf8'));
        offset = size;
      }
    }
  }

  // last `n` lines of the file, empty file -> no lines
  protected readTail(lpath: string, n: number): string[] {
    const content = readFileSync(lpath, 'utf8');
    const all = content.length ? content.split('\n') : [];
    // drop the empty element produced by a trailing newline
    if (all[all.length - 1] === '') {
      all.pop();
    }
    return all.slice(-n);
  }

  // parse -n / --lines <n>, default 20
  protected parseLines(): number {
    const idx = this.args.findIndex(a => a === '-n' || a === '--lines');
    if (idx === -1) {
      return 20;
    }
    const raw = this.args[idx + 1];
    const n = raw ? parseInt(raw, 10) : 20;
    return isNaN(n) || n <= 0 ? 20 : n;
  }
}
