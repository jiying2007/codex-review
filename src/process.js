'use strict';

const { t } = require('./i18n');
const { createProcessRunner } = require('./codex-safe-core/process-runner');

const runner = createProcessRunner((_zh, en) => t(en));

module.exports = Object.freeze({
  isWindowsScript: runner.isWindowsScript,
  quoteWindowsCmdArg: runner.quoteWindowsCmdArg,
  prepareCommand: runner.prepareCommand,
  runProcess: runner.runPreparedProcess,
  runProcessBuffer: runner.runProcessBuffer
});
