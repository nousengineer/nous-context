#!/usr/bin/env node

import { Command } from 'commander';
import { registerProjectCommands } from './commands/project';
import { registerContextCommands } from './commands/context';
import { registerDecisionCommands } from './commands/decision';
import { registerExportCommands } from './commands/export';
import { registerInitCommand } from './commands/init';

const program = new Command();

program
  .name('think')
  .description('ThinkBrew CLI - Manage AI context from the terminal')
  .version('1.0.0');

registerProjectCommands(program);
registerContextCommands(program);
registerDecisionCommands(program);
registerExportCommands(program);
registerInitCommand(program);

program.parse();
