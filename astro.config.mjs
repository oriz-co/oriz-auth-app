// @ts-check
import { defineConfig } from 'astro/config'

export default defineConfig({
  site: 'https://auth.oriz.in',
  output: 'static',
  trailingSlash: 'ignore',
  build: { format: 'directory' },
  vite: {
    resolve: {
      alias: { '~': new URL('./src', import.meta.url).pathname },
    },
  },
})
