import { input, select } from '../terminal.js';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

import { Command } from "../types";
import { listSkills, loadSkill, readSkill, parseSkill } from '../skills';
import * as constants from '../constants';

// `marvin skills [command] [--dry]` list and add (create) skills
export default class SkillsCommand extends Command {
  async exec() {
    this.logger.debug('[SkillsCommand.exec]');

    const cmd = this.args[0] || 'help';
    switch (cmd) {
      default:
        this.logger.warn('[SkillsCommand.exec]', 'unknown command: skills', cmd);
      case 'help':
        await this.execHelp();
      break;
      // `marvin skills list` // list available skills
      case 'list':
        await this.execList();
      break;
      // `marvin skills add [name] [description]` // create a custom skill
      case 'add':
        await this.execAdd();
      break;
      // `marvin skills use [skill]` // apply a skill interactively
      case 'use':
        await this.execUse();
      break;
    }
  }

  // `marvin skills help`
  async execHelp() {
    this.logger.info('usage: marvin skills [command] [--dry]');
    this.logger.info('commands:');
    this.logger.info('  help                 ', 'show this help');
    this.logger.info('  list                 ', 'list available skills');
    this.logger.info('  add <name> [desc]    ', 'create a custom skill by prompting the LLM (~/.marvin/skills)');
    this.logger.info('  use [skill]          ', 'use a skill: pick a skill, answer its questions, run it (tools-create/tools-edit write ~/.marvin/tools)');
  }

  // `marvin skills list`
  async execList() {
    this.logger.debug('[SkillsCommand.execList]');

    // all skills: defaults shipped with marvin + custom workspace skills
    const files = listSkills(this.engine);

    this.logger.info('skills:');
    if (files.length === 0) this.logger.info('  (none)');
    for (const file of files) {
      const id = file.replace(/\.md$/i, '').toLowerCase();
      const skill = this.engine.skills[id];
      this.logger.info(`  ${id}${skill ? ` (${skill.source})` : ''}`);
      if (skill?.description) this.logger.info('  -', skill.description);
    }
  }

  // `marvin skills add [name] [description]` // create a custom skill
  async execAdd() {
    this.logger.debug('[SkillsCommand.execAdd]', 'creating a skill...');

    // ask for the skill name
    const name = this.args[1] || await input({
      message: 'Enter skill name (e.g. release-notes):',
      required: true,
      pattern: /^[a-zA-Z0-9_-]+$/,
      patternError: 'invalid skill name (use a-z, 0-9, _ and -)',
    });
    if (!name || !/^[a-zA-Z0-9_-]+$/.test(name)) {
      this.logger.error('[SkillsCommand.execAdd]', 'invalid skill name (use a-z, 0-9, _ and -):', name);
      return;
    }

    // skills are identified by their lowercase id
    const id = name.toLowerCase();

    // ask for what the skill should do
    const description = this.args.slice(2).join(' ') || await input({ message: 'Enter what the skill should do (e.g. write release notes from a changelog):', required: true });
    if (!description) {
      this.logger.error('[SkillsCommand.execAdd]', 'no description provided, exiting');
      return;
    }

    // check if the skill already exists
    const spath = join(this.engine.work, 'skills', `${id}.md`);
    if (existsSync(spath)) {
      this.logger.warn(`skill "${name}" already exists at ${spath}`);
      return;
    }

    // load the skills-create skill that teaches how to create skills
    let instructions: string;
    try {
      instructions = readSkill(loadSkill(this.engine, 'skills-create'));
    } catch {
      this.logger.error('[SkillsCommand.execAdd]', 'the "skills-create" skill was not found, cannot create skills');
      return;
    }

    // load the engine (models + agents) so we can prompt the LLM
    await this.engine.load();

    const prompt = [
      instructions,
      '',
      '## Task',
      `Create a new skill named "${id}".`,
      description,
      '',
      'Return ONLY the skill file content.',
    ].join('\n');

    let content = '';
    if (this.engine.isDry) {
      this.logger.info('[dry]', 'prompt:', prompt.slice(0, 200));
    } else {
      const result = await this.engine.agents[this.engine.config.settings.name]!.sendChat(undefined, prompt);
      if (result.error || !result.content) {
        this.logger.error('[SkillsCommand.execAdd]', 'no result from the LLM');
        return;
      }
      content = result.content.trim();
    }

    // persist the skill to ~/.marvin/skills/<id>.md
    if (this.engine.isDry) {
      this.logger.info('[dry]', `would write skill to ${spath}`);
    } else {
      mkdirSync(join(this.engine.work, 'skills'), { recursive: true });
      writeFileSync(spath, content + '\n');
      // register the skill in the engine (no reload needed)
      this.engine.skills[id] = parseSkill(spath, 'custom');
    }

    this.logger.info(`skill "${id}" created, saved to ${spath}`);
  }

  // `marvin skills use [skill] [<name>]` // apply a skill interactively
  async execUse() {
    this.logger.debug('[SkillsCommand.execUse]', 'using a skill...');

    // ensure skills are loaded (defaults + custom) so we can pick from them
    await this.engine.load();

    const ids = [...new Set(listSkills(this.engine).map(f => f.replace(/\.md$/i, '').toLowerCase()))];

    // pick a skill (positional arg or prompt)
    let id = (this.args[1] || '').toLowerCase();
    if (!id) {
      id = await select({
        message: 'Pick a skill:',
        choices: ids.map(sid => ({
          name: sid,
          value: sid,
          description: this.engine.skills[sid]?.description,
        })),
      });
      if (!id) {
        this.logger.error('[SkillsCommand.execUse]', 'no skill selected, exiting');
        return;
      }
    }

    let instructions: string;
    try {
      instructions = readSkill(loadSkill(this.engine, id));
    } catch {
      this.logger.error('[SkillsCommand.execUse]', 'unknown skill:', id);
      return;
    }

    // ask the necessary info for the skill (tool skills get a name + purpose/change, others a task)
    let toolName = '';
    let info = '';
    const isToolCreate = id === 'tools-create';
    const isToolEdit = id === 'tools-edit';
    if (isToolCreate || isToolEdit) {
      toolName = this.args[2] || await input({ message: 'Tool name (e.g. web_search):', required: true });
      // replace non-alphanumeric characters with underscores
      toolName = toolName.replace(/[^a-zA-Z0-9_]/g, '_');
      toolName = toolName.replace(/_+/g, '_');
      toolName = toolName.toLowerCase();
      if (!toolName) {
        this.logger.error('[SkillsCommand.execUse]', 'invalid tool name (use a-z, 0-9, _):', toolName);
        return;
      }
      if (isToolCreate) {
        info = await input({ message: 'What should the tool do?', required: true });
      } else {
        // editing an existing tool: read the current code so we can send it to the LLM
        const tpath = join(this.engine.work, 'tools', `${toolName}.ts`);
        if (!existsSync(tpath)) {
          this.logger.error('[SkillsCommand.execUse]', 'tool does not exist in ~/.marvin/tools:', toolName);
          return;
        }
        info = await input({ message: 'What should change about the tool?', required: true });
      }
      if (!info) {
        this.logger.error('[SkillsCommand.execUse]', 'no tool description provided, exiting');
        return;
      }
    } else {
      info = await input({ message: 'Describe what you want to do with this skill:', required: true });
      if (!info) {
        this.logger.error('[SkillsCommand.execUse]', 'no task provided, exiting');
        return;
      }
    }

    const currentCode = isToolEdit
      ? readFileSync(join(this.engine.work, 'tools', `${toolName}.ts`), 'utf8')
      : '';

    const prompt = [
      instructions,
      '',
      isToolEdit ? '## Current tool code' : '## Task',
      isToolEdit ? ['```typescript', currentCode, '```'].join('\n') : undefined,
      isToolCreate ? `Create a new tool named "${toolName.toLowerCase()}".` : undefined,
      isToolEdit ? `Edit the tool "${toolName.toLowerCase()}" to: ${info}` : info,
      '',
    ].filter(l => l !== undefined).join('\n');

    let output = '';
    if (this.engine.isDry) {
      this.logger.info('[dry]', 'prompt:', prompt.slice(0, 200));
    } else {
      const result = await this.engine.agents[this.engine.config.settings.name]!.sendChat(undefined, prompt);
      if (result.error || !result.content) {
        this.logger.error('[SkillsCommand.execUse]', 'no result from the LLM');
        return;
      }
      output = result.content.trim();
    }

    // persist tools (~/.marvin/tools) so the custom tools feature can pick them up
    if (isToolCreate || isToolEdit) {
      if (this.engine.isDry) {
        this.logger.info('[dry]', isToolCreate ? 'would create tool in ~/.marvin/tools' : 'would update tool in ~/.marvin/tools');
      } else {
        // resolve the MARVIN_ROOT placeholder the tool skills keep literal in the import
        output = output.replaceAll('{MARVIN_ROOT}', this.engine.root);
        const tpath = join(this.engine.work, 'tools', `${toolName.toLowerCase()}.ts`);
        mkdirSync(join(this.engine.work, 'tools'), { recursive: true });
        writeFileSync(tpath, output + '\n');
        this.logger.info(`${isToolCreate ? 'tool' : 'tool'} "${toolName.toLowerCase()}" ${isToolCreate ? 'created' : 'updated'}, saved to ${tpath}`);
      }
    }

    this.logger.info('');
    this.logger.info(`used skill "${id}":`);
    this.logger.info(output || '(dry run, no output produced)');
  }
}
