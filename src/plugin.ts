import { definePlugin } from '@paperclipai/plugin-sdk';
import type { PluginContext } from '@paperclipai/plugin-sdk';
import { TICK } from './manifest.ts';
import type { FixturePublisher } from './queue.ts';

export function registerTick(ctx: Pick<PluginContext, 'jobs'>, configured: FixturePublisher | null = null): void {
  ctx.jobs.register(TICK, async job => {
    // Jobs have no company context. Only trusted composition supplies a fixture allowlist.
    // Deployed default has no authority, no store proof and no configured companies => no work.
    if (configured) {
      try { await configured.tick(job.runId); }
      catch { throw new Error('publisher-tick-refused'); }
    }
  });
}
export default definePlugin({ async setup(ctx: PluginContext) { registerTick(ctx); } });
