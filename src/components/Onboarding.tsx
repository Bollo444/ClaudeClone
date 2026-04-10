import React, { useState } from 'react';
import { useInput } from '../ink.js';
import { Box, Text } from '../ink.js';
import { getGlobalConfig, saveGlobalConfig } from '../utils/config.js';
import { ThemePicker } from './ThemePicker.js';
import { WelcomeV2 } from './LogoV2/WelcomeV2.js';
import type { ThemeSetting } from '../utils/theme.js';

type Step = 'provider' | 'baseUrl' | 'model' | 'theme' | 'done';

type Props = {
  onDone(): void;
};

const PROVIDERS = [
  { label: 'Anthropic API', value: 'anthropic', hint: 'Use api.anthropic.com' },
  { label: 'Custom provider', value: 'custom', hint: 'Set your own base URL' },
];

function SimpleInput({
  placeholder,
  onSubmit,
  onBack,
}: {
  placeholder: string;
  onSubmit: (value: string) => void;
  onBack: () => void;
}) {
  const [value, setValue] = useState('');

  useInput((input, key) => {
    if (key.escape) {
      onBack();
    } else if (key.return) {
      onSubmit(value);
    } else if (key.backspace) {
      setValue(v => v.slice(0, -1));
    } else if (key.ctrl && input === 'w') {
      // Ctrl+W delete word
      setValue(v => v.replace(/\s*\w+\s*$/, ''));
    } else if (input.length === 1 && !key.ctrl && !key.meta) {
      setValue(v => v + input);
    }
  });

  return (
    <Box flexDirection="column" gap={1} paddingLeft={1}>
      <Text>
        <Text dimColor>{placeholder}{value ? '' : ' › '}</Text>
        {value && <Text>{value}</Text>}
        {value && <Text inverse> </Text>}
        {!value && <Text inverse> </Text>}
      </Text>
      <Text dimColor>Enter to confirm · Esc to go back</Text>
    </Box>
  );
}

export function Onboarding({ onDone }: Props): React.ReactNode {
  const [step, setStep] = useState<Step>('provider');
  const [focusedProvider, setFocusedProvider] = useState(0);
  const [provider, setProvider] = useState('anthropic');
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');

  function persistConfig(selectedTheme: ThemeSetting) {
    const config = getGlobalConfig();
    const env: Record<string, string> = { ...(config.env || {}) };

    if (provider === 'custom' && baseUrl) {
      env.ANTHROPIC_BASE_URL = baseUrl;
      env.CLAUDE_CODE_USE_CUSTOM = 'true';
    } else {
      delete env.ANTHROPIC_BASE_URL;
      delete env.CLAUDE_CODE_USE_CUSTOM;
    }

    if (model) {
      env.ANTHROPIC_CUSTOM_MODEL_OPTION = model;
    }

    saveGlobalConfig(current => ({
      ...current,
      hasCompletedOnboarding: true,
      lastOnboardingVersion: MACRO.VERSION,
      theme: selectedTheme,
      env,
    }));

    if (provider === 'custom' && baseUrl) {
      process.env.ANTHROPIC_BASE_URL = baseUrl;
      process.env.CLAUDE_CODE_USE_CUSTOM = 'true';
    }
    if (model) {
      process.env.ANTHROPIC_CUSTOM_MODEL_OPTION = model;
    }
  }

  // Provider step: raw useInput
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
        if (selected.value === 'anthropic') {
          setStep('model');
        } else {
          setStep('baseUrl');
        }
      }
    } else if (key.escape) {
      onDone();
    }
  }, { isActive: step === 'provider' });

  const handleThemeSelection = (newTheme: ThemeSetting) => {
    persistConfig(newTheme);
    onDone();
  };

  // --- Render ---
  let content: React.ReactNode;

  if (step === 'provider') {
    content = (
      <Box flexDirection="column" gap={1} paddingLeft={1}>
        <Text bold>Choose your API provider:</Text>
        {PROVIDERS.map((p, i) => (
          <Box key={p.value}>
            <Text color={i === focusedProvider ? 'suggestion' : undefined}>
              {i === focusedProvider ? '› ' : '  '}
              {p.label}
            </Text>
            {i === focusedProvider && (
              <Text dimColor> — {p.hint}</Text>
            )}
          </Box>
        ))}
        <Text dimColor>Enter to confirm · ↑↓ to navigate · Esc to exit</Text>
      </Box>
    );
  } else if (step === 'baseUrl') {
    content = (
      <Box flexDirection="column" gap={1} paddingLeft={1}>
        <Text bold>Enter your API base URL:</Text>
        <SimpleInput
          placeholder="https://api.example.com/v1"
          onSubmit={(v: string) => { setBaseUrl(v); setStep('model'); }}
          onBack={() => setStep('provider')}
        />
      </Box>
    );
  } else if (step === 'model') {
    content = (
      <Box flexDirection="column" gap={1} paddingLeft={1}>
        <Text bold>Enter your model name:</Text>
        <SimpleInput
          placeholder={provider === 'anthropic' ? 'claude-sonnet-4-6-20250514' : 'your-model-name'}
          onSubmit={(v: string) => { setModel(v); setStep('theme'); }}
          onBack={() => setStep('baseUrl')}
        />
      </Box>
    );
  } else if (step === 'theme') {
    content = (
      <Box marginX={1}>
        <ThemePicker
          onThemeSelect={handleThemeSelection}
          showIntroText={false}
          helpText="Choose your theme"
          hideEscToCancel={false}
          skipExitHandling={true}
        />
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <WelcomeV2 />
      <Box flexDirection="column" marginTop={1}>
        {content}
      </Box>
    </Box>
  );
}
