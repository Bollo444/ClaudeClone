import * as React from 'react';
import { useInput } from '../../ink.js';
import { Box, Text, useTheme } from '../../ink.js';
import { getGlobalConfig, saveGlobalConfig } from '../../utils/config.js';
import type { LocalJSXCommandCall } from '../../types/command.js';

type Step = 'provider' | 'apiKey' | 'baseUrl' | 'model' | 'done';

const PROVIDERS = [
  { label: 'Anthropic API', value: 'anthropic', hint: 'api.anthropic.com' },
  { label: 'Custom provider', value: 'custom', hint: 'Your own endpoint' },
];

function truncateKey(key: string): string {
  if (key.length <= 8) return key;
  return key.slice(0, 8) + '…' + key.slice(-4);
}

function ApiConfigPanel({ onDone }: { onDone: () => void }) {
  const [step, setStep] = React.useState<Step>('provider');
  const [focusedProvider, setFocusedProvider] = React.useState(0);
  const [provider, setProvider] = React.useState(() => {
    const config = getGlobalConfig();
    const env = config.env || {};
    return env.CLAUDE_CODE_USE_CUSTOM === 'true' ? 'custom' : 'anthropic';
  });
  const [apiKey, setApiKey] = React.useState('');
  const [baseUrl, setBaseUrl] = React.useState(() => {
    const config = getGlobalConfig();
    return (config.env || {}).ANTHROPIC_BASE_URL || '';
  });
  const [model, setModel] = React.useState(() => {
    const config = getGlobalConfig();
    return (config.env || {}).ANTHROPIC_CUSTOM_MODEL_OPTION || '';
  });

  const [theme] = useTheme();
  const isDark = !['light', 'light-daltonized', 'light-ansi'].includes(theme);

  function persist() {
    const config = getGlobalConfig();
    const env: Record<string, string> = { ...(config.env || {}) };

    if (apiKey) {
      env.ANTHROPIC_API_KEY = apiKey;
    }
    if (provider === 'custom' && baseUrl) {
      env.ANTHROPIC_BASE_URL = baseUrl;
      env.CLAUDE_CODE_USE_CUSTOM = 'true';
    } else if (provider === 'anthropic') {
      delete env.ANTHROPIC_BASE_URL;
      delete env.CLAUDE_CODE_USE_CUSTOM;
    }

    if (model) {
      env.ANTHROPIC_CUSTOM_MODEL_OPTION = model;
    }

    saveGlobalConfig(current => ({
      ...current,
      hasCompletedOnboarding: true,
      env,
    }));

    // Apply to current session
    if (apiKey) process.env.ANTHROPIC_API_KEY = apiKey;
    if (provider === 'custom' && baseUrl) {
      process.env.ANTHROPIC_BASE_URL = baseUrl;
      process.env.CLAUDE_CODE_USE_CUSTOM = 'true';
    }
    if (model) process.env.ANTHROPIC_CUSTOM_MODEL_OPTION = model;
  }

  // Provider step
  useInput((_input, key) => {
    if (step !== 'provider') return;
    if (key.upArrow) {
      setFocusedProvider(i => Math.max(i - 1, 0));
    } else if (key.downArrow) {
      setFocusedProvider(i => Math.min(i + 1, PROVIDERS.length - 1));
    } else if (key.return) {
      const selected = PROVIDERS[focusedProvider];
      if (selected) {
        setProvider(selected.value);
        setStep('apiKey');
      }
    } else if (key.escape) {
      onDone();
    }
  }, { isActive: step === 'provider' });

  // Text input step (reusable via hook pattern)
  const [inputValue, setInputValue] = React.useState('');

  React.useEffect(() => {
    setInputValue(step === 'apiKey' ? apiKey : step === 'baseUrl' ? baseUrl : model);
  }, [step]);

  useInput((input, key) => {
    if (step === 'provider') return;

    if (key.escape) {
      if (step === 'apiKey') setStep('provider');
      else if (step === 'baseUrl') setStep('apiKey');
      else if (step === 'model') setStep('baseUrl');
    } else if (key.return) {
      if (step === 'apiKey') {
        setApiKey(inputValue);
        setStep('baseUrl');
      } else if (step === 'baseUrl') {
        setBaseUrl(inputValue);
        setStep('model');
      } else if (step === 'model') {
        setModel(inputValue);
        persist();
        onDone();
      }
    } else if (key.backspace) {
      setInputValue(v => v.slice(0, -1));
    } else if (key.ctrl && input === 'u') {
      setInputValue('');
    } else if (key.ctrl && input === 'w') {
      setInputValue(v => v.replace(/[^\s]+$/, ''));
    } else if (!key.ctrl && !key.meta && !key.return && input.length > 0) {
      setInputValue(v => v + input);
    }
  }, { isActive: step !== 'provider' });

  const accent = isDark ? 'suggestion' : 'blue';

  // --- Provider step ---
  if (step === 'provider') {
    return (
      <Box flexDirection="column" gap={1} paddingX={1}>
        <Text bold>API Provider</Text>
        <Box width={60} flexDirection="column" gap={1}>
          {PROVIDERS.map((p, i) => (
            <Box key={p.value}>
              <Text color={i === focusedProvider ? accent : undefined}>
                {i === focusedProvider ? '› ' : '  '}
                {p.label}
              </Text>
              {i === focusedProvider && <Text dimColor> — {p.hint}</Text>}
            </Box>
          ))}
        </Box>
        <Text dimColor>Enter · ↑↓ navigate · Esc to close</Text>
      </Box>
    );
  }

  // --- Text input steps ---
  const stepConfig = {
    apiKey: { label: 'API Key', placeholder: 'sk-ant-api03-…' },
    baseUrl: {
      label: 'Base URL',
      placeholder: provider === 'custom' ? 'https://api.example.com/v1' : 'https://api.anthropic.com',
    },
    model: { label: 'Model', placeholder: 'claude-sonnet-4-6-20250514' },
  }[step];

  const displayValue = inputValue || stepConfig.placeholder;
  const isDim = !inputValue;

  const stepLabels = ['API Key', 'Base URL', 'Model'];
  const stepIdx = step === 'apiKey' ? 0 : step === 'baseUrl' ? 1 : 2;

  return (
    <Box flexDirection="column" gap={1} paddingX={1}>
      {/* Step progress */}
      <Box flexDirection="row" gap={1} marginBottom={1}>
        {stepLabels.map((l, i) => (
          <Text key={l} color={i < stepIdx ? 'success' : i === stepIdx ? accent : 'gray3'}>
            {i < stepIdx ? '✓' : i === stepIdx ? '›' : '○'} {l}
          </Text>
        ))}
      </Box>

      <Text bold>{stepConfig.label}</Text>
      {step === 'apiKey' && (
        <Box width={60}>
          <Text>
            <Text inverse> </Text>
          </Text>
        </Box>
      )}
      {step !== 'apiKey' && (
        <Box width={60}>
          <Text>
            {isDim && <Text dimColor>{displayValue}</Text>}
            {!isDim && <Text>{displayValue}</Text>}
            <Text inverse> </Text>
          </Text>
        </Box>
      )}
      {step === 'apiKey' && (
        <Box width={60}>
          <Text dimColor>Paste or type your API key…</Text>
        </Box>
      )}

      <Text dimColor>Enter to confirm · Esc to go back</Text>
    </Box>
  );
}

export const call: LocalJSXCommandCall = async (onDone) => {
  return <ApiConfigPanel onDone={() => onDone('')} />;
};
