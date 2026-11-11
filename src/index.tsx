#!/usr/bin/env node
import { render } from 'ink';
import { App, loadSources } from './app.js';
import { errorMessage } from './types.js';
import { loadUsers } from './users.js';

// .env lives in the tt project directory, so `tt` works from anywhere.
try {
  process.loadEnvFile(new URL('../.env', import.meta.url));
} catch {
  // No .env: every source will show "not configured".
}

const sources = loadSources();
let users;
try {
  users = await loadUsers();
} catch (e) {
  console.error(`tt: ${errorMessage(e)}`);
  process.exit(1);
}

if (process.argv.includes('--once')) {
  // Debug mode: print each list as plain text and exit.
  for (const u of users) for (const s of sources) {
    console.log(`== ${users.length > 1 ? `${u.name} · ` : ''}${s.name}`);
    try {
      for (const t of await s.fetch(u, { allCycles: false })) console.log([...t.left, { text: t.title }, ...(t.badges ?? []), ...t.right].map((c) => c.text).join(' '));
    } catch (e) {
      console.log(`error: ${errorMessage(e)}`);
    }
  }
  process.exit(0);
}

const app = render(<App sources={sources} users={users} />, { alternateScreen: true });
await app.waitUntilExit();
process.exit(0);
