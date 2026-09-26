import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const appDirectory = resolve(scriptDirectory, '..');
const repositoryRoot = resolve(appDirectory, '../..');

try {
  process.loadEnvFile(resolve(repositoryRoot, '.env'));
} catch (error) {
  if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') {
    throw error;
  }
}

process.chdir(appDirectory);
await import('../node_modules/next/dist/bin/next');
