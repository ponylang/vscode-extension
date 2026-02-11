import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
  files: 'build/test/test/**/*.test.js',
  mocha: {
    ui: 'bdd',
  },
});
