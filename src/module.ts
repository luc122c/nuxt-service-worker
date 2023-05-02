import { resolve, dirname } from 'path';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { defineNuxtModule, extendViteConfig } from '@nuxt/kit';
import type { ViteDevServer } from 'vite';
import { defu } from 'defu';
import {
  cleanupManifests,
  installDevMiddleware,
  moveOutputFile,
  rollupBuildPlugin,
  rollupPlugin,
} from './build';

export interface ModuleOptions {
  entryPoint: string | false;
}

export default defineNuxtModule<ModuleOptions>({
  meta: {
    name: 'nuxt3-service-worker',
    configKey: 'serviceWorker',
    compatibility: {
      nuxt: '^3.4.0',
    },
  },
  defaults: {
    entryPoint: false,
  },
  setup(options, nuxt) {
    if (!options.entryPoint) {
      throw new Error(
        'Service worker entry point is not set, no routes will be generated'
      );
    }

    if (nuxt.options.builder === '@nuxt/webpack-builder') {
      throw new Error(
        'Service worker module supports only Vite/Rollup build stack'
      );
    }

    const resolvedEntry = resolve(nuxt.options.rootDir, options.entryPoint);
    if (!existsSync(resolvedEntry)) {
      throw new Error(
        'Service worker entry point does not exists: ' + resolvedEntry
      );
    }

    const plugin = rollupPlugin(nuxt.options.dev);
    nuxt.hook('nitro:config', (config) => {
      config.rollupConfig ||= {};
      config.rollupConfig.plugins ||= [];
      if (Array.isArray(config.rollupConfig.plugins)) {
        config.rollupConfig.plugins.push(plugin);
      } else {
        config.rollupConfig.plugins = [plugin];
      }
    });

    extendViteConfig((config) => {
      config.plugins ||= [];
      config.plugins.push(plugin);
    });

    nuxt.hook('prepare:types', (ev) => {
      const typesFile = resolve(
        dirname(fileURLToPath(import.meta.url)),
        'runtime.d.ts'
      );
      ev.references.push({ path: typesFile });
    });

    if (nuxt.options.dev) {
      let server: ViteDevServer;
      nuxt.hook('vite:serverCreated', (srv: ViteDevServer, ctx) => {
        if (ctx.isClient) {
          server = srv;
        }
      });

      installDevMiddleware(() => server, resolvedEntry);
    } else {
      const buildPlugin = rollupBuildPlugin(resolvedEntry);
      nuxt.hook('vite:extendConfig', (config, { isClient }) => {
        if (!isClient) return;
        config.build = defu(config.build, {
          rollupOptions: {
            plugins: [buildPlugin],
          },
        });
      });

      nuxt.hook('nitro:build:public-assets', async (nitro) => {
        await moveOutputFile(buildPlugin, nitro);
        await cleanupManifests(
          nitro.options.buildDir,
          nuxt.options.rootDir,
          resolvedEntry
        );
      });
    }
  },
});
