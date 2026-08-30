import { editor, input, number, select } from '../terminal.js';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

import { Command } from "../types";
import logger from '../logger.js';

// `marvin tasks [command]` add/list tasks
export default class TasksCommand extends Command {
  async exec() {
    logger.debug('[TasksCommand.exec]');

    const cmd = this.args[0] || 'help';
    switch (cmd) {
      default:
        logger.warn('[TasksCommand.exec]', 'unknown command: tasks', cmd);
      case 'help':
        logger.info('usage: marvin tasks [command]');
        logger.info('commands:');
        logger.info('  help    ', 'show this help');
        logger.info('  list    ', 'list tasks');
        logger.info('  add     ', 'add a task interactively');
      break;
      case 'list':
        await this.execList();
      break;
      case 'add':
        await this.execAdd();
      break;
    }
  }

  // `marvin tasks list`
  async execList() {
    logger.debug('[TasksCommand.execList]');

    const tasks = this.engine.config.tasks || {};
    if (Object.keys(tasks).length === 0) {
      logger.info('  no tasks configured');
      return;
    }
    for (const [taskId, task] of Object.entries(tasks)) {
      logger.info(`  - ${taskId} (agent: ${task.agent || this.engine.config.settings.name}, enabled: ${task.enabled}, schedule: ${task.schedule}s)`);
    }
  }

  // `marvin tasks add [agentId] [taskId]` // add a task interactively
  async execAdd() {
    logger.debug('[TasksCommand.execAdd]', 'adding a task...');

    // ask for agentId (defaults to the orchestrator, or the first configured agent)
    const agentIds = Object.keys(this.engine.config.agents);
    if (agentIds.length === 0) {
      logger.error('[TasksCommand.execAdd]', 'no agents configured, please run "marvin agents add" first');
      return;
    }

    const marvin = this.engine.config.settings.name;
    const defaultAgent = agentIds.includes(marvin) ? marvin : agentIds[0]!;
    const taskAgent = this.args[1] || await select({
      message: `Select agent (default "${defaultAgent}"):`,
      choices: agentIds.map(id => ({ name: id, value: id })),
      default: defaultAgent,
    });
    if (!this.engine.config.agents[taskAgent!] && taskAgent !== marvin) {
      logger.error('[TasksCommand.execAdd]', `agent "${taskAgent}" not found`, 'available agents:', agentIds.join(', '));
      return;
    }

    // ask for taskId
    const taskId = this.args[2]! || await input({
      message: 'Enter task name (e.g. my-task):',
      required: true,
      pattern: /^[a-zA-Z0-9_-]+$/,
      patternError: 'invalid task name (use a-z, 0-9, _ and -)',
    });
    if (!taskId || !/^[a-zA-Z0-9_-]+$/.test(taskId)) {
      logger.error('[TasksCommand.execAdd]', 'invalid task name (use a-z, 0-9, _ and -):', taskId);
      return;
    }
    if (this.engine.config.tasks?.[taskId]) {
      logger.warn('[TasksCommand.execAdd]', `task "${taskId}" already exists`);
      return;
    }

    // ask for the task prompt (multi-line markdown), saved to tasks/<taskId>/TASK.md
    const taskInput = await editor({ message: 'Write the task prompt input inside the editor:', default: '', postfix: '.md' });

    // ask for schedule (in seconds)
    const taskSchedule = (await number({ message: 'Enter schedule in seconds (default 3600):', default: 3600, min: 0 })) ?? 3600;
    if (taskSchedule < 0) {
      logger.error('[TasksCommand.execAdd]', 'invalid schedule, must be a positive number of seconds');
      return;
    }

    logger.log('');

    // persist the task prompt to tasks/<taskId>/TASK.md
    let ppath: string = '';
    if (taskInput) {
      ppath = join(this.engine.work, 'tasks', taskId, 'TASK.md');
      mkdirSync(join(this.engine.work, 'tasks', taskId), { recursive: true });
      writeFileSync(ppath, taskInput + '\n');
    }

    // register the task in config (tools now load lazily via load_tools)
    this.engine.config.tasks = this.engine.config.tasks || {};
    this.engine.config.tasks[taskId] = {
      enabled: true,
      agent: taskAgent,
      schedule: taskSchedule,
    };

    // persist to marvin.json
    const cpath = join(this.engine.work, 'marvin.json');
    writeFileSync(cpath, JSON.stringify(this.engine.config, null, 2));

    logger.info(`task "${taskId}" configured for agent "${taskAgent}" (schedule: ${taskSchedule}s ${ppath ? `, prompt saved to ${ppath}` : ''}`);
  }
}
