import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const targets = JSON.parse(readFileSync(new URL('./targets.json', import.meta.url), 'utf8'));
if (process.env.NABD_HOSTED_BUILD !== '1') throw new Error('Hosting is paused. Use npm run dev locally. Set NABD_HOSTED_BUILD=1 only when resuming an explicitly requested deployment.');
const api = new URL(targets.railway.apiOrigin);
if (api.protocol !== 'https:') throw new Error('Hosted frontend requires an HTTPS API origin');
const result = spawnSync(process.execPath, ['node_modules/vinext/dist/cli.js', 'build'], {
  stdio: 'inherit',
  windowsHide: true,
  env: { ...process.env, NEXT_PUBLIC_API_BASE_URL: api.origin },
});
process.exitCode = result.status ?? 1;
