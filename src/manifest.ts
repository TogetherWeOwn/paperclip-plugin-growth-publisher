import type { PaperclipPluginManifestV1 } from '@paperclipai/plugin-sdk';
export const TICK = 'publisher-tick';
const manifest: PaperclipPluginManifestV1 = {
  id: 'togetherweown.growth-publisher', apiVersion: 1, version: '0.1.0',
  displayName: 'Fixture Growth Publisher',
  description: 'Offline fixture queue foundation. No live publishing, approvals, credentials or network adapters.',
  author: 'TogetherWeOwn', categories: ['automation'],
  capabilities: ['jobs.schedule', 'database.namespace.read', 'database.namespace.write', 'database.namespace.migrate'],
  entrypoints: { worker: './dist/worker.js' },
  database: { namespaceSlug: 'growth_publisher', migrationsDir: './migrations', coreReadTables: [] },
  jobs: [{ jobKey: TICK, displayName: 'Fixture publisher tick', schedule: '* * * * *' }],
  instanceConfigSchema: { type: 'object', properties: {}, additionalProperties: false },
};
export default manifest;
