/**
 * OpenCode Adapter Integration Tests
 *
 * Requires `opencode` CLI to be installed.
 * Run with: pnpm --filter @openlobby/core test -- --grep "opencode"
 */
import { createAdapterIntegrationTests } from './adapter-contract.js';
import { OpenCodeAdapter } from '../opencode.js';

createAdapterIntegrationTests(() => new OpenCodeAdapter(), {
  simplePrompt: 'Reply with exactly the word: HELLO_TEST',
});
