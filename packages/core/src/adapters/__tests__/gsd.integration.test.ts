/**
 * GSD Adapter Integration Tests
 *
 * Requires `gsd` CLI to be installed.
 * Run with: pnpm --filter @openlobby/core test -- --grep "gsd"
 */
import { createAdapterIntegrationTests } from './adapter-contract.js';
import { GsdAdapter } from '../gsd.js';

createAdapterIntegrationTests(() => new GsdAdapter(), {
  spawnOverrides: { permissionMode: 'auto' },
});
