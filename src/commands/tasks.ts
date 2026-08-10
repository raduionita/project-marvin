import { promises } from 'readline';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

import { Command } from "../types";
import * as constants from '../constants';

// `marvin tasks [command] [--dry]` add/list tasks for an agent
export default class TasksCommand extends Command {
  // overridable for tests (scripted answers)
  public ask?: (question: string) => Promise<string>;

  async exec() {
    console.debug('[TasksCommand.exec]');

    const cmd = this.args[0] || 'help';
    switch (cmd) {
      default:
        console.warn('[TasksCommand.exec]', 'unknown command: tasks', cmd);
      case 'help':
        console.info('usage: marvin tasks [command] [--dry]');
        console.info('commands:');
        console.info('  help    ', 'show this help');
        console.info('  list    ', 'list tasks for each configured agent');
        console.info('  add     ', 'add a task interactively');
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
    console.debug('[TasksCommand.execList]');

    const agents = this.engine.config.agents;
    if (Object.keys(agents).length === 0) {
      console.info('  no agents configured');
      return;
    }
    for (const [agentId, agent] of Object.entries(agents)) {
      console.info(`  ${agentId}:`);
      const tasks = agent.tasks || {};
      if (Object.keys(tasks).length === 0) {
        console.info('    (no tasks)');
      }
      for (const [taskId, task] of Object.entries(tasks)) {
        console.info(`    - ${taskId} (enabled: ${task.enabled}, schedule: ${task.schedule}s)`);
      }
    }
  }

  // `marvin tasks add [agentId] [taskId]` // add a task interactively
  async execAdd() {
    console.debug('[TasksCommand.execAdd]', 'adding a task...');

    const ask = this.ask || (async (q: string) => {
      const pli = promises.createInterface({ input: process.stdin, output: process.stdout });
      const answer = (await pli.question(q)).trim();
      pli.close();
      return answer;
    });

    // ask for agentId
    const agentIds = Object.keys(this.engine.config.agents);
    if (agentIds.length === 0) {
      console.error('[TasksCommand.execAdd]', 'no agents configured, please run "marvin agents add" first');
      return;
    }
    console.log('');
    const defaultAgent = agentIds[0]!;
    const agentId = (this.args[1] || await ask(`Enter agent name (press enter for "${defaultAgent}"): `) || defaultAgent);
    if (!this.engine.config.agents[agentId!]) {
      console.error('[TasksCommand.execAdd]', `agent "${agentId}" not found in config`);
      console.error('[TasksCommand.execAdd]', 'available agents:', agentIds.join(', '));
      return;
    }

    // ask for taskId
    const taskId = this.args[2]! || await ask('Enter task name (e.g. my-task): ');
    if (!taskId || !/^[a-zA-Z0-9_-]+$/.test(taskId)) {
      console.error('[TasksCommand.execAdd]', 'invalid task name (use a-z, 0-9, _ and -):', taskId);
      return;
    }
    if (this.engine.config.agents[agentId]?.tasks?.[taskId]) {
      console.warn('[TasksCommand.execAdd]', `task "${taskId}" already exists for agent "${agentId}"`);
      return;
    }

    // ask for the task prompt, saved to agents/<agentId>/tasks/<taskId>/TASK.md
    const input = await ask('Enter task prompt (or press enter to skip): ');

    // ask for schedule (in seconds)
    const scheduleRaw = await ask('Enter schedule in seconds (press enter for 3600): ') || '3600';
    const schedule = parseInt(scheduleRaw, 10);
    if (isNaN(schedule) || schedule < 0) {
      console.error('[TasksCommand.execAdd]', 'invalid schedule, must be a positive number of seconds');
      return;
    }

    // ask for maxSteps
    const maxStepsRaw = await ask(`Enter max steps (press enter for ${constants.DEFAULT_MAX_STEPS}): `) || `${constants.DEFAULT_MAX_STEPS}`;
    const maxSteps = parseInt(maxStepsRaw, 10);
    if (isNaN(maxSteps) || maxSteps < 0) {
      console.error('[TasksCommand.execAdd]', 'invalid max steps, must be a positive number');
      return;
    }

    // ask for format
    const format = await ask('Enter output format "text" or "json" (press enter for "json"): ') || 'json';
    if (format !== 'text' && format !== 'json') {
      console.error('[TasksCommand.execAdd]', 'invalid format, use "text" or "json"');
      return;
    }

    console.log('');

    // persist the task prompt to agents/<agentId>/tasks/<taskId>/TASK.md
    const apath = this.engine.config.agents[agentId];
    let pinn: string | null = null;
    if (input) {
      const ppath = join(this.engine.work, 'agents', agentId, 'tasks', taskId, 'TASK.md');
      if (this.engine.isDry) {
        console.info('[TasksCommand.execAdd]', '[dry]', 'task prompt file:', ppath);
      } else {
        mkdirSync(join(this.engine.work, 'agents', agentId, 'tasks', taskId), { recursive: true });
        writeFileSync(ppath, input + '\n');
      }
      pinn = ppath;
    }

    // register the task in config
    apath!.tasks = apath!.tasks || {};
    apath!.tasks![taskId] = {
      enabled: true,
      schedule,
      maxSteps,
      format,
      schema: constants.DEFAULT_SCHEMA,
    };

    // persist to marvin.json
    const cpath = join(this.engine.work, 'marvin.json');
    if (this.engine.isDry) {
      console.info('[TasksCommand.execAdd]', '[dry]', `would configure task "${taskId}" for agent "${agentId}", config persisted to ${cpath}`);
    } else {
      writeFileSync(cpath, JSON.stringify(this.engine.config, null, 2));
    }

    console.info(`[TasksCommand.execAdd]`, `task "${taskId}" configured for agent "${agentId}" (schedule: ${schedule}s, maxSteps: ${maxSteps})${pinn ? `, prompt saved to ${pinn}` : ''}`);
    console.warn('[TasksCommand.execAdd]', 'note: run "marvin reload" to apply the new task to the running daemon');
  }
}