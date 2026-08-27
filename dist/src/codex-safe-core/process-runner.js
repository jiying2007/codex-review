'use strict';

const { spawn } = require('child_process');
const path = require('path');

/** @typedef {(zh: string, en: string) => string} Translate */
/** @typedef {{dispose: () => void}} DisposableLike */
/** @typedef {{isCancellationRequested: boolean, onCancellationRequested: (listener: () => void) => DisposableLike}} CancellationTokenLike */
/** @typedef {{cwd?: string, env?: NodeJS.ProcessEnv, shell?: boolean, windowsVerbatimArguments?: boolean, timeoutMs?: number, maxStdoutBytes?: number, maxStderrBytes?: number}} ProcessOptions */
/** @typedef {Error & {code?: string|number, stdout?: string|Buffer, stderr?: string|Buffer}} ProcessError */

const DEFAULT_TEXT_STDOUT_LIMIT = 4 * 1024 * 1024;
const DEFAULT_TEXT_STDERR_LIMIT = 1 * 1024 * 1024;
const DEFAULT_BUFFER_STDOUT_LIMIT = 16 * 1024 * 1024;
const DEFAULT_BUFFER_STDERR_LIMIT = 256 * 1024;
const FORCE_KILL_DELAY_MS = 1500;

function createProcessRunner(ui = (_zh, en) => en) {
  if (typeof ui !== 'function') throw new TypeError('createProcessRunner requires a translation function.');

  function isWindowsScript(command) {
    return process.platform === 'win32' && /\.(cmd|bat)$/i.test(String(command || ''));
  }

  function quoteWindowsCmdArg(value) {
    return `"${String(value).replace(/"/g, '""')}"`;
  }

  function prepareCommand(command, args) {
    if (typeof command !== 'string' || !command || /[\r\n\0]/.test(command)) {
      throw new TypeError('command must be a non-empty string without control characters.');
    }
    if (!Array.isArray(args) || args.some(arg => typeof arg !== 'string' || /\0/.test(arg))) {
      throw new TypeError('args must be an array of strings without NUL characters.');
    }
    if (!isWindowsScript(command)) return { command, args: [...args], shell: false };
    const commandLine = '"' + [quoteWindowsCmdArg(command), ...args.map(quoteWindowsCmdArg)].join(' ') + '"';
    return {
      command: process.env.ComSpec || 'cmd.exe',
      args: ['/d', '/v:off', '/s', '/c', commandLine],
      shell: false,
      windowsVerbatimArguments: true
    };
  }

  function normalizeLimit(value, fallback, name) {
    if (value === undefined) return fallback;
    if (!Number.isFinite(value) || value < 0 || value > 256 * 1024 * 1024) {
      throw new RangeError(`${name} must be a finite value between 0 and 268435456 bytes.`);
    }
    return Math.floor(value);
  }

  function normalizeTimeout(value) {
    if (value === undefined) return 0;
    if (!Number.isFinite(value) || value < 0 || value > 30 * 60 * 1000) {
      throw new RangeError('timeoutMs must be between 0 and 1800000.');
    }
    return Math.floor(value);
  }

  function createTerminationError(code, zh, en) {
    const error = /** @type {ProcessError} */ (new Error(ui(zh, en)));
    error.code = code;
    return error;
  }

  function execute(command, args, options = {}, stdinText = '', cancellationToken, mode = 'text') {
    if (options.shell === true) {
      const error = new Error('Shell execution is forbidden by Codex Safe Core.');
      error.code = 'ESHELLFORBIDDEN';
      return Promise.reject(error);
    }

    const timeoutMs = normalizeTimeout(options.timeoutMs);
    const textMode = mode === 'text';
    const maxStdoutBytes = normalizeLimit(
      options.maxStdoutBytes,
      textMode ? DEFAULT_TEXT_STDOUT_LIMIT : DEFAULT_BUFFER_STDOUT_LIMIT,
      'maxStdoutBytes'
    );
    const maxStderrBytes = normalizeLimit(
      options.maxStderrBytes,
      textMode ? DEFAULT_TEXT_STDERR_LIMIT : DEFAULT_BUFFER_STDERR_LIMIT,
      'maxStderrBytes'
    );

    return new Promise((resolve, reject) => {
      let child;
      let settled = false;
      let terminating = false;
      let timeoutHandle;
      let forceKillHandle;
      let cancellationDisposable;
      let terminationError;
      const stdoutChunks = [];
      const stderrChunks = [];
      let stdoutBytes = 0;
      let stderrBytes = 0;

      const cleanup = () => {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        if (forceKillHandle) clearTimeout(forceKillHandle);
        cancellationDisposable?.dispose();
      };

      const settle = (fn, value) => {
        if (settled) return;
        settled = true;
        cleanup();
        fn(value);
      };

      const killTree = () => {
        if (!child || child.killed || !child.pid) return Promise.resolve();
        if (process.platform === 'win32') {
          return new Promise(resolve => {
            const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
              windowsHide: true,
              shell: false,
              stdio: 'ignore'
            });
            killer.once('close', resolve);
            killer.once('error', () => {
              try { child.kill(); } catch {}
              resolve();
            });
          });
        }
        try { process.kill(-child.pid, 'SIGTERM'); }
        catch { try { child.kill('SIGTERM'); } catch {} }
        return Promise.resolve();
      };

      const forceKillTree = () => {
        if (!child || !child.pid) return;
        if (process.platform === 'win32') {
          try {
            spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
              windowsHide: true,
              shell: false,
              stdio: 'ignore'
            });
          } catch {}
          return;
        }
        try { process.kill(-child.pid, 'SIGKILL'); }
        catch { try { child.kill('SIGKILL'); } catch {} }
      };

      const terminate = error => {
        if (terminating || settled) return;
        terminating = true;
        terminationError = error;
        void killTree().finally(() => {
          if (settled) return;
          forceKillHandle = setTimeout(() => {
            forceKillTree();
            settle(reject, error);
          }, FORCE_KILL_DELAY_MS);
        });
      };

      try {
        child = spawn(command, args, {
          cwd: options.cwd,
          env: options.env || process.env,
          windowsHide: true,
          shell: false,
          windowsVerbatimArguments: options.windowsVerbatimArguments === true,
          detached: process.platform !== 'win32'
        });
      } catch (error) {
        settle(reject, error);
        return;
      }

      child.stdout.on('data', chunk => {
        const buffer = Buffer.from(chunk);
        stdoutBytes += buffer.length;
        if (stdoutBytes > maxStdoutBytes) {
          terminate(createTerminationError(
            'EOUTPUTLIMIT',
            `子进程 stdout 超过限制（${maxStdoutBytes} bytes）`,
            `Child process stdout exceeded the limit (${maxStdoutBytes} bytes)`
          ));
          return;
        }
        stdoutChunks.push(buffer);
      });

      child.stderr.on('data', chunk => {
        const buffer = Buffer.from(chunk);
        stderrBytes += buffer.length;
        if (stderrBytes > maxStderrBytes) {
          terminate(createTerminationError(
            'EOUTPUTLIMIT',
            `子进程 stderr 超过限制（${maxStderrBytes} bytes）`,
            `Child process stderr exceeded the limit (${maxStderrBytes} bytes)`
          ));
          return;
        }
        stderrChunks.push(buffer);
      });

      child.stdin.on('error', error => {
        if (error?.code !== 'EPIPE' && !terminating) settle(reject, error);
      });
      child.once('error', error => settle(reject, error));
      child.once('close', code => {
        if (settled) return;
        if (terminationError) {
          settle(reject, terminationError);
          return;
        }
        const stdoutBuffer = Buffer.concat(stdoutChunks);
        const stderrBuffer = Buffer.concat(stderrChunks);
        if (code === 0) {
          settle(resolve, textMode
            ? { stdout: stdoutBuffer.toString('utf8'), stderr: stderrBuffer.toString('utf8') }
            : { stdout: stdoutBuffer, stderr: stderrBuffer });
          return;
        }
        const stdout = textMode ? stdoutBuffer.toString('utf8') : stdoutBuffer;
        const stderr = textMode ? stderrBuffer.toString('utf8') : stderrBuffer;
        const detail = textMode
          ? (stderr || stdout)
          : (stderrBuffer.toString('utf8') || stdoutBuffer.toString('utf8'));
        const error = /** @type {ProcessError} */ (new Error(
          `${path.basename(command)} exited with code ${code}\n${detail}`.trim()
        ));
        error.code = code ?? -1;
        error.stdout = stdout;
        error.stderr = stderr;
        settle(reject, error);
      });

      if (timeoutMs > 0) {
        timeoutHandle = setTimeout(() => {
          const seconds = Math.round(timeoutMs / 1000);
          terminate(createTerminationError(
            'ETIMEDOUT',
            `进程执行超时（${seconds} 秒）`,
            `Process timed out after ${seconds} seconds`
          ));
        }, timeoutMs);
      }

      if (cancellationToken) {
        const cancel = () => terminate(createTerminationError('ECANCELLED', '操作已取消。', 'Operation cancelled.'));
        if (cancellationToken.isCancellationRequested) {
          cancel();
          return;
        }
        cancellationDisposable = cancellationToken.onCancellationRequested(cancel);
      }

      if (stdinText) child.stdin.write(stdinText, 'utf8');
      child.stdin.end();
    });
  }

  function runProcess(command, args, options = {}, stdinText = '', cancellationToken) {
    return execute(command, args, options, stdinText, cancellationToken, 'text');
  }

  function runPreparedProcess(command, args, options = {}, stdinText = '', cancellationToken) {
    let prepared;
    try { prepared = prepareCommand(command, args); }
    catch (error) { return Promise.reject(error); }
    return execute(
      prepared.command,
      prepared.args,
      { ...options, shell: false, windowsVerbatimArguments: prepared.windowsVerbatimArguments === true },
      stdinText,
      cancellationToken,
      'text'
    );
  }

  function runProcessBuffer(command, args, options = {}, cancellationToken) {
    return execute(command, args, options, '', cancellationToken, 'buffer');
  }

  return Object.freeze({
    isWindowsScript,
    quoteWindowsCmdArg,
    prepareCommand,
    runPreparedProcess,
    runProcess,
    runProcessBuffer
  });
}

module.exports = {
  DEFAULT_TEXT_STDOUT_LIMIT,
  DEFAULT_TEXT_STDERR_LIMIT,
  DEFAULT_BUFFER_STDOUT_LIMIT,
  DEFAULT_BUFFER_STDERR_LIMIT,
  FORCE_KILL_DELAY_MS,
  createProcessRunner
};
