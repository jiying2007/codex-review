'use strict';

const { spawn } = require('child_process');
const path = require('path');
const { t } = require('./i18n');

function isWindowsScript(command) {
  return process.platform === 'win32' && /\.(cmd|bat)$/i.test(command);
}

function quoteWindowsCmdArg(value) {
  const s = String(value);
  const escaped = s
    .replace(/\^/g, '^^')
    .replace(/%/g, '%%')
    .replace(/!/g, '^^!')
    .replace(/"/g, '""')
    .replace(/([&|<>])/g, '^$1');
  return `"${escaped}"`;
}

function prepareCommand(command, args) {
  if (!isWindowsScript(command)) {
    return { command, args, shell: false };
  }
  const commandLine = [quoteWindowsCmdArg(command), ...args.map(quoteWindowsCmdArg)].join(' ');
  return {
    command: process.env.ComSpec || 'cmd.exe',
    args: ['/d', '/s', '/c', `"${commandLine}"`],
    shell: false,
    windowsVerbatimArguments: true
  };
}

function runProcess(command, args, options = {}, stdinText = '', token) {
  return new Promise((resolve, reject) => {
    const prepared = options.prepared === false
      ? { command, args, shell: false }
      : prepareCommand(command, args);

    let child;
    let settled = false;
    let timeoutHandle;
    let forceKillHandle;
    let cancellationDisposable;
    let terminationError;
    let terminating = false;

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

    const terminate = (error) => {
      if (terminating) return;
      terminating = true;
      terminationError = error;

      if (!child || child.killed) {
        settle(reject, error);
        return;
      }

      if (process.platform === 'win32' && child.pid) {
        const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
          windowsHide: true,
          shell: false,
          stdio: 'ignore'
        });
        killer.once('close', () => settle(reject, error));
        killer.once('error', () => {
          try { child.kill(); } catch {}
          settle(reject, error);
        });
        return;
      }

      try {
        if (options.detached && child.pid) process.kill(-child.pid, 'SIGTERM');
        else child.kill('SIGTERM');
      } catch {}

      forceKillHandle = setTimeout(() => {
        try {
          if (options.detached && child.pid) process.kill(-child.pid, 'SIGKILL');
          else child.kill('SIGKILL');
        } catch {}
        settle(reject, error);
      }, 1500);
    };

    try {
      child = spawn(prepared.command, prepared.args, {
        cwd: options.cwd,
        env: options.env || process.env,
        windowsHide: true,
        shell: prepared.shell,
        windowsVerbatimArguments: prepared.windowsVerbatimArguments === true,
        detached: options.detached === true
      });
    } catch (error) {
      settle(reject, error);
      return;
    }

    let stdout = '';
    let stderr = '';
    let stdoutBytes = 0;
    let stderrBytes = 0;
    const maxStdoutBytes = options.maxStdoutBytes ?? (6 * 1024 * 1024);
    const maxStderrBytes = options.maxStderrBytes ?? (1 * 1024 * 1024);

    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');

    child.stdout?.on('data', chunk => {
      stdoutBytes += Buffer.byteLength(chunk, 'utf8');
      if (stdoutBytes > maxStdoutBytes) {
        const error = new Error(t('Subprocess stdout exceeded the limit ({0} bytes).', maxStdoutBytes));
        error.code = 'EOUTPUTLIMIT';
        terminate(error);
        return;
      }
      stdout += chunk;
    });

    child.stderr?.on('data', chunk => {
      stderrBytes += Buffer.byteLength(chunk, 'utf8');
      if (stderrBytes > maxStderrBytes) {
        const error = new Error(t('Subprocess stderr exceeded the limit ({0} bytes).', maxStderrBytes));
        error.code = 'EOUTPUTLIMIT';
        terminate(error);
        return;
      }
      stderr += chunk;
    });

    child.once('error', error => settle(reject, error));
    child.once('close', code => {
      if (settled) return;
      if (terminationError) {
        if (process.platform === 'win32' || !options.detached) {
          settle(reject, terminationError);
        }
        return;
      }

      if (code === 0) {
        settle(resolve, { stdout, stderr });
      } else {
        const error = new Error(
          `${path.basename(command)} exited with code ${code}\n${stderr || stdout}`.trim()
        );
        error.code = code;
        error.stdout = stdout;
        error.stderr = stderr;
        settle(reject, error);
      }
    });

    if (options.timeoutMs > 0) {
      timeoutHandle = setTimeout(() => {
        const error = new Error(t('Process timed out after {0} seconds.', Math.round(options.timeoutMs / 1000)));
        error.code = 'ETIMEDOUT';
        terminate(error);
      }, options.timeoutMs);
    }

    if (token) {
      if (token.isCancellationRequested) {
        const error = new Error(t('Operation cancelled.'));
        error.code = 'ECANCELLED';
        terminate(error);
        return;
      }
      cancellationDisposable = token.onCancellationRequested(() => {
        const error = new Error(t('Operation cancelled.'));
        error.code = 'ECANCELLED';
        terminate(error);
      });
    }

    if (stdinText) child.stdin?.write(stdinText, 'utf8');
    child.stdin?.end();
  });
}

function runProcessBuffer(command, args, options = {}, token) {
  return new Promise((resolve, reject) => {
    let child;
    let settled = false;
    let timeoutHandle;
    let cancellationDisposable;
    let stdout = [];
    let stderr = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    const maxStdoutBytes = options.maxStdoutBytes ?? (16 * 1024 * 1024);
    const maxStderrBytes = options.maxStderrBytes ?? (256 * 1024);

    const cleanup = () => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      cancellationDisposable?.dispose();
    };
    const settle = (fn, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn(value);
    };
    const terminate = (error) => {
      try { child?.kill('SIGKILL'); } catch {}
      settle(reject, error);
    };

    try {
      child = spawn(command, args, {
        cwd: options.cwd,
        env: options.env || process.env,
        windowsHide: true,
        shell: false
      });
    } catch (error) {
      settle(reject, error);
      return;
    }

    child.stdout?.on('data', chunk => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > maxStdoutBytes) {
        const error = new Error(t('Subprocess stdout exceeded the limit ({0} bytes).', maxStdoutBytes));
        error.code = 'EOUTPUTLIMIT';
        terminate(error);
        return;
      }
      stdout.push(Buffer.from(chunk));
    });
    child.stderr?.on('data', chunk => {
      stderrBytes += chunk.length;
      if (stderrBytes > maxStderrBytes) {
        const error = new Error(t('Subprocess stderr exceeded the limit ({0} bytes).', maxStderrBytes));
        error.code = 'EOUTPUTLIMIT';
        terminate(error);
        return;
      }
      stderr.push(Buffer.from(chunk));
    });

    child.once('error', error => settle(reject, error));
    child.once('close', code => {
      if (settled) return;
      const out = Buffer.concat(stdout);
      const err = Buffer.concat(stderr);
      if (code === 0) {
        settle(resolve, { stdout: out, stderr: err });
      } else {
        const error = new Error(
          `${path.basename(command)} exited with code ${code}\n${err.toString('utf8') || out.toString('utf8')}`.trim()
        );
        error.code = code;
        settle(reject, error);
      }
    });

    if (options.timeoutMs > 0) {
      timeoutHandle = setTimeout(() => {
        const error = new Error(t('Process timed out after {0} seconds.', Math.round(options.timeoutMs / 1000)));
        error.code = 'ETIMEDOUT';
        terminate(error);
      }, options.timeoutMs);
    }

    if (token) {
      if (token.isCancellationRequested) {
        const error = new Error(t('Operation cancelled.'));
        error.code = 'ECANCELLED';
        terminate(error);
        return;
      }
      cancellationDisposable = token.onCancellationRequested(() => {
        const error = new Error(t('Operation cancelled.'));
        error.code = 'ECANCELLED';
        terminate(error);
      });
    }
  });
}

module.exports = {
  isWindowsScript,
  quoteWindowsCmdArg,
  prepareCommand,
  runProcess,
  runProcessBuffer
};
