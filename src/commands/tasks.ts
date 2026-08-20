import { checkbox, input, number, select } from '@inquirer/prompts';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

import { Command } from "../types";

// `marvin tasks [command] [--dry]` add/list tasks
export default class TasksCommand extends Command {
  async exec() {
    this.logger.debug('[TasksCommand.exec]');

    const cmd = this.args[0] || 'help';
    switch (cmd) {
      default:
        this.logger.warn('[TasksCommand.exec]', 'unknown command: tasks', cmd);
      case 'help':
        this.logger.info('usage: marvin tasks [command] [--dry]');
        this.logger.info('commands:');
        this.logger.info('  help    ', 'show this help');
        this.logger.info('  list    ', 'list tasks');
        this.logger.info('  add     ', 'add a task interactively');
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
    this.logger.debug('[TasksCommand.execList]');

    const tasks = this.engine.config.tasks || {};
    if (Object.keys(tasks).length === 0) {
      this.logger.info('  no tasks configured');
      return;
    }
    for (const [taskId, task] of Object.entries(tasks)) {
      this.logger.info(`  - ${taskId} (agent: ${task.agent || this.engine.config.settings.name}, enabled: ${task.enabled}, schedule: ${task.schedule}s)`);
    }
  }

  // `marvin tasks add [agentId] [taskId]` // add a task interactively
  async execAdd() {
    this.logger.debug('[TasksCommand.execAdd]', 'adding a task...');

    // ask for agentId (defaults to the orchestrator, or the first configured agent)
    const agentIds = Object.keys(this.engine.config.agents);
    if (agentIds.length === 0) {
      this.logger.error('[TasksCommand.execAdd]', 'no agents configured, please run "marvin agents add" first');
      return;
    }

    const marvin = this.engine.config.settings.name;
    const defaultAgent = agentIds.includes(marvin) ? marvin : agentIds[0]!;
    const agentId = this.args[1] || await select({
      message: `Select agent (default "${defaultAgent}"):`,
      choices: agentIds.map(id => ({ name: id, value: id })),
      default: defaultAgent,
    });
    if (!this.engine.config.agents[agentId!] && agentId !== marvin) {
      this.logger.error('[TasksCommand.execAdd]', `agent "${agentId}" not found`, 'available agents:', agentIds.join(', '));
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
      this.logger.error('[TasksCommand.execAdd]', 'invalid task name (use a-z, 0-9, _ and -):', taskId);
      return;
    }
    if (this.engine.config.tasks?.[taskId]) {
      this.logger.warn('[TasksCommand.execAdd]', `task "${taskId}" already exists`);
      return;
    }

    // ask for the task prompt, saved to tasks/<taskId>/TASK.md
    const taskPrompt = await input({ message: 'Enter task prompt (or press enter to skip):' });

    // ask for schedule (in seconds)
    const schedule = (await number({ message: 'Enter schedule in seconds (default 3600):', default: 3600, min: 0 })) ?? 3600;
    if (schedule < 0) {
      this.logger.error('[TasksCommand.execAdd]', 'invalid schedule, must be a positive number of seconds');
      return;
    }

    // ask which configured integrations to link (their actions become tools)
    const integrationIds = Object.keys(this.engine.config.integrations || {});
    const integrations: string[] = [];
    if (integrationIds.length) {
      const picked = await checkbox({
        message: 'Select integrations to link (space to toggle, enter to confirm):',
        choices: integrationIds.map(id => ({ name: id, value: id })),
      });
      for (const id of picked) {
        if (!integrationIds.includes(id)) {
          this.logger.warn('[TasksCommand.execAdd]', `unknown integration "${id}", skipping`);
          continue;
        }
        if (!integrations.includes(id)) integrations.push(id);
      }
    }

    this.logger.log('');

    // persist the task prompt to tasks/<taskId>/TASK.md
    let pinn: string | null = null;
    if (taskPrompt) {
      const ppath = join(this.engine.work, 'tasks', taskId, 'TASK.md');
      if (this.engine.isDry) {
        this.logger.info('[TasksCommand.execAdd]', '[dry]', 'task prompt file:', ppath);
      } else {
        mkdirSync(join(this.engine.work, 'tasks', taskId), { recursive: true });
        writeFileSync(ppath, taskPrompt + '\n');
      }
      pinn = ppath;
    }

    // register the task in config
    this.engine.config.tasks = this.engine.config.tasks || {};
    this.engine.config.tasks[taskId] = {
      enabled: true,
      agent: agentId,
      schedule,
      ...(integrations.length ? { integrations } : {}),
    };

    // persist to marvin.json
    const cpath = join(this.engine.work, 'marvin.json');
    if (this.engine.isDry) {
      this.logger.info('[TasksCommand.execAdd]', '[dry]', `would configure task "${taskId}" for agent "${agentId}", config persisted to ${cpath}`);
    } else {
      writeFileSync(cpath, JSON.stringify(this.engine.config, null, 2));
    }

    this.logger.info(`[TasksCommand.execAdd]`, `task "${taskId}" configured for agent "${agentId}" (schedule: ${schedule}s ${pinn ? `, prompt saved to ${pinn}` : ''}`);
    this.logger.warn('[TasksCommand.execAdd]', 'note: run "marvin reload" to apply the new task to the running daemon');
  }
}
