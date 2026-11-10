import { defineConfig } from 'vite';

// Client-side previews use the original components, with a separate build.
export default defineConfig({
  server: {
    watch: {
      ignored: ['**/storybook-static/**', '**/dist/**', '**/.wrangler/**', '**/work/**'],
    },
  },
});
