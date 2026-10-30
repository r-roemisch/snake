import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset paths so the build works under GitHub Pages' /snake/ sub-path.
  base: './',
});
