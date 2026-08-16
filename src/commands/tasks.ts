import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

import { Command } from "../types";
import * as constants from '../constants';
import { ask } from '../terminal';

// `marvin tasks [command] [--dry]` add/list tasks for an agent
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
        this.logger.info('  list    ', 'list tasks for each configured agent');
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

    const agents = this.engine.config.agents;
    if (Object.keys(agents).length === 0) {
      this.logger.info('  no agents configured');
      return;
    }
    for (const [agentId, agent] of Object.entries(agents)) {
      this.logger.info(`  ${agentId}:`);
      const tasks = agent.tasks || {};
      if (Object.keys(tasks).length === 0) {
        this.logger.info('    (no tasks)');
      }
      for (const [taskId, task] of Object.entries(tasks)) {
        this.logger.info(`    - ${taskId} (enabled: ${task.enabled}, schedule: ${task.schedule}s)`);
      }
    }
  }

  // `marvin tasks add [agentId] [taskId]` // add a task interactively
  async execAdd() {
    this.logger.debug('[TasksCommand.execAdd]', 'adding a task...');

    // ask for agentId
    const agentIds = Object.keys(this.engine.config.agents);
    if (agentIds.length === 0) {
      this.logger.error('[TasksCommand.execAdd]', 'no agents configured, please run "marvin agents add" first');
      return;
    }
    
    const marvin = agentIds[0]!;
    const agentId = (this.args[1] || await ask(`Enter agent name (press enter for "${marvin}"): `) || marvin);
    if (!this.engine.config.agents[agentId!]) {
      this.logger.error('[TasksCommand.execAdd]', `agent "${agentId}" not found`, 'available agents:', agentIds.join(', '));
      return;
    }

    // ask for taskId
    const taskId = this.args[2]! || await ask('Enter task name (e.g. my-task): ');
    if (!taskId || !/^[a-zA-Z0-9_-]+$/.test(taskId)) {
      this.logger.error('[TasksCommand.execAdd]', 'invalid task name (use a-z, 0-9, _ and -):', taskId);
      return;
    }
    if (this.engine.config.agents[agentId]?.tasks?.[taskId]) {
      this.logger.warn('[TasksCommand.execAdd]', `task "${taskId}" already exists for agent "${agentId}"`);
      return;
    }

    // ask for the task prompt, saved to agents/<agentId>/tasks/<taskId>/TASK.md
    const input = await ask('Enter task prompt (or press enter to skip): ');

    // ask for schedule (in seconds)
    const scheduleRaw = await ask('Enter schedule in seconds (press enter for 3600): ') || '3600';
    const schedule = parseInt(scheduleRaw, 10);
    if (isNaN(schedule) || schedule < 0) {
      this.logger.error('[TasksCommand.execAdd]', 'invalid schedule, must be a positive number of seconds');
      return;
    }

    // ask for maxSteps
    const maxStepsRaw = await ask(`Enter max steps (press enter for ${constants.DEFAULT_MAX_STEPS}): `) || `${constants.DEFAULT_MAX_STEPS}`;
    const maxSteps = parseInt(maxStepsRaw, 10);
    if (isNaN(maxSteps) || maxSteps < 0) {
      this.logger.error('[TasksCommand.execAdd]', 'invalid max steps, must be a positive number');
      return;
    }

    // ask for format
    const format = await ask('Enter output format "text" or "json" (press enter for "json"): ') || 'json';
    if (format !== 'text' && format !== 'json') {
      this.logger.error('[TasksCommand.execAdd]', 'invalid format, use "text" or "json"');
      return;
    }

    // ask which configured integrations to link (their actions become tools)
    const integrationIds = Object.keys(this.engine.config.integrations || {});
    const integrations: string[] = [];
    if (integrationIds.length) {
      const raw = await ask(`Enter integrations to link (comma separated, e.g. ${integrationIds.join(',')}), press enter for none: `);
      for (const id of raw.split(',').map(s => s.trim()).filter(Boolean)) {
        if (!integrationIds.includes(id)) {
          this.logger.warn('[TasksCommand.execAdd]', `unknown integration "${id}", skipping`);
          continue;
        }
        if (!integrations.includes(id)) integrations.push(id);
      }
    }

    this.logger.log('');

    // persist the task prompt to agents/<agentId>/tasks/<taskId>/TASK.md
    const agent = this.engine.config.agents[agentId]!;
    let pinn: string | null = null;
    if (input) {
      const ppath = join(this.engine.work, 'agents', agentId, 'tasks', taskId, 'TASK.md');
      if (this.engine.isDry) {
        this.logger.info('[TasksCommand.execAdd]', '[dry]', 'task prompt file:', ppath);
      } else {
        mkdirSync(join(this.engine.work, 'agents', agentId, 'tasks', taskId), { recursive: true });
        writeFileSync(ppath, input + '\n');
      }
      pinn = ppath;
    }

    // register the task in config
    agent.tasks = agent.tasks || {};
    agent.tasks[taskId] = {
      enabled: true,
      schedule,
      maxSteps,
      format,
      schema: constants.DEFAULT_SCHEMA,
      ...(integrations.length ? { integrations } : {}),
    };

    // persist to marvin.json
    const cpath = join(this.engine.work, 'marvin.json');
    if (this.engine.isDry) {
      this.logger.info('[TasksCommand.execAdd]', '[dry]', `would configure task "${taskId}" for agent "${agentId}", config persisted to ${cpath}`);
    } else {
      writeFileSync(cpath, JSON.stringify(this.engine.config, null, 2));
    }

    this.logger.info(`[TasksCommand.execAdd]`, `task "${taskId}" configured for agent "${agentId}" (schedule: ${schedule}s, maxSteps: ${maxSteps})${pinn ? `, prompt saved to ${pinn}` : ''}`);
    this.logger.warn('[TasksCommand.execAdd]', 'note: run "marvin reload" to apply the new task to the running daemon');
  }
}
