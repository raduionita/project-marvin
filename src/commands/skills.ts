import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { promises } from 'readline';

import { Command } from "../types";
import { listSkills, listCustomSkills, readSkill, parseSkill } from '../skills';
import * as constants from '../constants';

// `marvin skills [command] [--dry]` list and add (create) skills
export default class SkillsCommand extends Command {
  // overridable for tests (scripted answers)
  public ask?: (question: string) => Promise<string>;

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

    // default skills shipped with marvin
    const defaults = listSkills(this.engine).map(f => f.replace('.md', '').toLowerCase());
    const custom = listCustomSkills(this.engine).map(f => f.replace('.md', '').toLowerCase());

    this.logger.info('default skills:');
    if (defaults.length === 0) this.logger.info('  (none)');
    for (const id of defaults) {
      const skill = this.engine.skills[id];
      this.logger.info(`  ${id}`);
      if (skill?.description) this.logger.info('  -', skill.description);
    }

    this.logger.info('custom skills:');
    if (custom.length === 0) this.logger.info('  (none)');
    for (const id of custom) {
      const skill = this.engine.skills[id];
      this.logger.info(`  ${id}`);
      if (skill?.description) this.logger.info('  -', skill.description);
    }
  }

  // `marvin skills add [name] [description]` // create a custom skill
  async execAdd() {
    this.logger.debug('[SkillsCommand.execAdd]', 'creating a skill...');

    const ask = this.ask || (async (q: string) => {
      const pli = promises.createInterface({ input: process.stdin, output: process.stdout });
      const answer = (await pli.question(q)).trim();
      pli.close();
      return answer;
    });

    // ask for the skill name
    const name = this.args[1] || await ask('Enter skill name (e.g. release-notes): ');
    if (!name || !/^[a-zA-Z0-9_-]+$/.test(name)) {
      this.logger.error('[SkillsCommand.execAdd]', 'invalid skill name (use a-z, 0-9, _ and -):', name);
      return;
    }

    // skills are identified by their lowercase id
    const id = name.toLowerCase();

    // ask for what the skill should do
    const description = this.args.slice(2).join(' ') || await ask('Enter what the skill should do (e.g. write release notes from a changelog): ');
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

    // load the META skill that teaches how to create skills
    const meta = this.engine.skills['meta'];
    if (!meta) {
      this.logger.error('[SkillsCommand.execAdd]', 'the "meta" skill is not loaded, cannot create skills');
      return;
    }
    const instructions = readSkill(meta);

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
      const result = await this.engine.execChat(undefined, this.engine.config.settings.name, prompt, 'text');
      if (!result || !result.content) {
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

    const ask = this.ask || (async (q: string) => {
      const pli = promises.createInterface({ input: process.stdin, output: process.stdout });
      const answer = (await pli.question(q)).trim();
      pli.close();
      return answer;
    });

    // ensure skills are loaded (defaults + custom) so we can pick from them
    await this.engine.load();

    const ids = [...new Set([...listSkills(this.engine), ...listCustomSkills(this.engine)])]
      .map(f => f.replace('.md', '').toLowerCase());

    // pick a skill (positional arg or prompt)
    let id = (this.args[1] || '').toLowerCase();
    if (!id) {
      this.logger.info('available skills:');
      for (const sid of ids) {
        const skill = this.engine.skills[sid];
        this.logger.info(`  ${sid}`, skill?.description ? '- ' + skill.description : '');
      }
      id = (await ask('Pick a skill: ')).toLowerCase();
      if (!id) {
        this.logger.error('[SkillsCommand.execUse]', 'no skill selected, exiting');
        return;
      }
    }

    const skill = this.engine.skills[id];
    if (!skill) {
      this.logger.error('[SkillsCommand.execUse]', 'unknown skill:', id);
      return;
    }
    const instructions = readSkill(skill);

    // ask the necessary info for the skill (tool skills get a name + purpose/change, others a task)
    let toolName = '';
    let info = '';
    const isToolCreate = id === 'tools-create';
    const isToolEdit = id === 'tools-edit';
    if (isToolCreate || isToolEdit) {
      toolName = this.args[2] || await ask('Tool name (e.g. web_search): ');
      // replace non-alphanumeric characters with underscores
      toolName = toolName.replace(/[^a-zA-Z0-9_]/g, '_');
      toolName = toolName.replace(/_+/g, '_');
      toolName = toolName.toLowerCase();
      if (!toolName) {
        this.logger.error('[SkillsCommand.execUse]', 'invalid tool name (use a-z, 0-9, _):', toolName);
        return;
      }
      if (isToolCreate) {
        info = await ask('What should the tool do? ');
      } else {
        // editing an existing tool: read the current code so we can send it to the LLM
        const tpath = join(this.engine.work, 'tools', `${toolName}.ts`);
        if (!existsSync(tpath)) {
          this.logger.error('[SkillsCommand.execUse]', 'tool does not exist in ~/.marvin/tools:', toolName);
          return;
        }
        info = await ask('What should change about the tool? ');
      }
      if (!info) {
        this.logger.error('[SkillsCommand.execUse]', 'no tool description provided, exiting');
        return;
      }
    } else {
      info = await ask('Describe what you want to do with this skill: ');
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
      const result = await this.engine.execChat(undefined, this.engine.config.settings.name, prompt, 'text');
      if (!result || !result.content) {
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
