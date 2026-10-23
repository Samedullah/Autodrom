import { spawn } from 'node:child_process';

const node = process.execPath;
const children = [
  spawn(node, ['server/index.js'], { stdio: 'inherit' }),
  spawn(node, ['node_modules/vite/bin/vite.js', '--host', '0.0.0.0'], { stdio: 'inherit' }),
];
let stopping = false;

function stop(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
  }
  process.exitCode = exitCode;
}

for (const child of children) {
  child.on('error', (error) => {
    console.error('Autodrom dev process failed to start:', error.message);
    stop(1);
  });
  child.on('exit', (code) => {
    if (!stopping) {
      console.error('A dev process stopped; shutting down the other process.');
      stop(code ?? 1);
    }
  });
}

process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
