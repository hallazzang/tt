#!/usr/bin/env node
import { render } from 'ink';
import { App, loadSources } from './app.js';
import { errorMessage } from './types.js';

// .env lives in the tt project directory, so `tt` works from anywhere.
try {
  process.loadEnvFile(new URL('../.env', import.meta.url));
} catch {
  // No .env: every source will show "not configured".
}

const sources = loadSources();

if (process.argv.includes('--once')) {
  // Debug mode: print each list as plain text and exit.
  for (const s of sources) {
    console.log(`== ${s.name}`);
    try {
      for (const t of await s.fetch()) console.log([...t.left, { text: t.title }, ...(t.badges ?? []), ...t.right].map((c) => c.text).join(' '));
    } catch (e) {
      console.log(`error: ${errorMessage(e)}`);
    }
  }
  process.exit(0);
}

const app = render(<App sources={sources} />, { alternateScreen: true });
await app.waitUntilExit();
process.exit(0);
