globalThis.MACRO = {
  VERSION: '2.1.88',
  BUILD_TIME: new Date().toISOString(),
  PACKAGE_URL: '@anthropic-ai/claude-code',
  NATIVE_PACKAGE_URL: '@anthropic-ai/claude-code',
  VERSION_CHANGELOG: '',
  ISSUES_EXPLAINER: '',
  FEEDBACK_CHANNEL: ''
};

await import('./cli.tsx');
