import tseslint from 'typescript-eslint';
import hooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
export default tseslint.config({ignores:['dist', 'test-results', 'playwright-report']},...tseslint.configs.recommended,{files:['**/*.{ts,tsx}'],languageOptions:{globals:globals.browser},plugins:{'react-hooks':hooks},rules:hooks.configs.recommended.rules},{files:['playwright.config.ts','tests/support/**/*.{ts,mjs}'],languageOptions:{globals:globals.node}});