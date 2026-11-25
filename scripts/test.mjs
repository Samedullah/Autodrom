// Runs tests/*.test.ts with Node's built-in test runner. esbuild (shipped with
// Vite) bundles each test file first, so the game's TypeScript runs unchanged.
import { build } from 'esbuild';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

// Outside node_modules: Node's test runner skips files under it.
const outdir = join(tmpdir(), 'autodrom-tests');
const filter = process.argv[2];
const entries = readdirSync('tests')
  .filter((file) => file.endsWith('.test.ts') && (!filter || file.includes(filter)))
  .map((file) => join('tests', file));
await build({ entryPoints: entries, bundle: true, platform: 'node', format: 'esm', outdir, logLevel: 'warning' });
const outputs = entries.map((entry) => join(outdir, entry.replace(/^tests\//, '').replace(/\.ts$/, '.js')));
const result = spawnSync(process.execPath, ['--test', '--test-reporter=spec', ...outputs], { stdio: 'inherit' });
process.exit(result.status ?? 1);
