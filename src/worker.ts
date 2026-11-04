import { runWorker } from '@paperclipai/plugin-sdk';
import plugin from './plugin.ts';
runWorker(plugin, import.meta.url);
