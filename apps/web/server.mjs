import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const signalExitCodes = { SIGINT: 130, SIGTERM: 143 };
const standaloneServer =
  process.env.KOBAKO_STANDALONE_SERVER ??
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '.next/standalone/apps/web/server.js');
const child = spawn(process.execPath, [standaloneServer], {
  env: process.env,
  stdio: 'inherit',
});

let forwardedSignal;
const forwardSignal = (signal) => {
  if (forwardedSignal) {
    return;
  }
  forwardedSignal = signal;
  child.kill(signal);
};

process.once('SIGINT', forwardSignal);
process.once('SIGTERM', forwardSignal);

const childExit = await new Promise((resolve) => {
  child.once('error', (error) => {
    console.error('[web] standalone server failed to start', { errorType: error.name });
    resolve({ code: 1, signal: undefined });
  });
  child.once('exit', (code, signal) => {
    resolve({ code, signal });
  });
});

if (forwardedSignal && childExit.code === signalExitCodes[forwardedSignal] && !childExit.signal) {
  // Next closes its HTTP server before using signal-style exit codes; report that graceful stop as 0.
  process.exitCode = 0;
} else if (childExit.signal) {
  process.exitCode = signalExitCodes[childExit.signal] ?? 1;
} else {
  process.exitCode = childExit.code ?? 1;
}
