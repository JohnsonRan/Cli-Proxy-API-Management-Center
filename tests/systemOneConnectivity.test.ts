import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { apiClient } from '@/services/api/client';
import { apiCallApi, type ApiCallRequest } from '@/services/api/apiCall';
import { providersApi } from '@/services/api/providers';
import { normalizeProviderGroups } from '@/services/api/transformers';
import {
  modelsSignature,
  useConnectivityTest,
  type ConnectivityErrorMessages,
  type UseConnectivityTestArgs,
} from '@/features/providers/sheets/forms/useConnectivityTest';
import type { OpenAIProviderConfig } from '@/types';

function captureHook<T>(hook: () => T): T {
  let result: T;
  function Harness() {
    result = hook();
    return null;
  }
  renderToStaticMarkup(createElement(Harness));
  return result!;
}

const messages: ConnectivityErrorMessages = {
  baseUrlRequired: 'base required',
  endpointInvalid: 'invalid endpoint',
  apiKeyRequired: 'key required',
  modelRequired: 'model required',
  timeout: () => 'timeout',
  requestFailed: 'failed',
};

const originalGet = apiClient.get;
const originalPut = apiClient.put;
let requestSpy: ReturnType<typeof spyOn<typeof apiCallApi, 'request'>> | undefined;
afterEach(() => {
  requestSpy?.mockRestore();
  apiClient.get = originalGet;
  apiClient.put = originalPut;
});

async function runTest(models: UseConnectivityTestArgs['models'], testModel?: string) {
  let captured: ApiCallRequest | undefined;
  requestSpy = spyOn(apiCallApi, 'request').mockImplementation(async (req) => {
    captured = req;
    return { statusCode: 200, header: {}, bodyText: '', body: { answers: {} } };
  });
  const hook = captureHook(() =>
    useConnectivityTest(
      {
        brand: 'openaiCompatibility',
        baseUrl: 'https://api.commandcode.ai/provider/v1',
        apiKeyEntries: [{ apiKey: 'cc-test' }],
        models,
        testModel,
        formHeaders: [],
      },
      messages
    )
  );
  const ok = await hook.runOpenAIKey(0);
  return { ok, captured };
}

describe('OpenAI-compatible System One connectivity test', () => {
  test('routes systemone models to /systemone with a minimal decision request', async () => {
    const { ok, captured } = await runTest([
      { name: 'typesafe/jev', alias: 'cc-jev', systemone: true },
    ]);

    expect(ok).toBe(true);
    expect(captured?.url).toBe('https://api.commandcode.ai/provider/v1/systemone');
    const body = JSON.parse(captured?.data ?? '{}');
    expect(body.model).toBe('typesafe/jev');
    expect(body.state).toBe('Hello');
    expect(body.questions.greeting.type).toBe('noul');
    expect(body.messages).toBeUndefined();
  });

  test('keeps unflagged models on /chat/completions', async () => {
    const { captured } = await runTest(
      [{ name: 'typesafe/jev', systemone: true }, { name: 'deepseek/deepseek-v4-flash' }],
      'deepseek/deepseek-v4-flash'
    );

    expect(captured?.url).toBe('https://api.commandcode.ai/provider/v1/chat/completions');
    const body = JSON.parse(captured?.data ?? '{}');
    expect(body.messages).toBeDefined();
    expect(body.max_tokens).toBe(5);
    expect(body.max_completion_tokens).toBeUndefined();
  });

  test('routes decisions-output models to OpenAI /decisions', async () => {
    const { ok, captured } = await runTest([
      { name: 'gpt-6-luna', originalOutputModalities: ['decisions'] },
    ]);

    expect(ok).toBe(true);
    expect(captured?.url).toBe('https://api.commandcode.ai/provider/v1/decisions');
    const body = JSON.parse(captured?.data ?? '{}');
    expect(body).toEqual({
      model: 'gpt-6-luna',
      input: 'Hello',
      questions: [{ type: 'predicate', name: 'greeting', instructions: 'Is this a greeting?' }],
    });
  });

  test('systemone flag wins over the decisions output modality', async () => {
    const { captured } = await runTest([
      { name: 'typesafe/jev', systemone: true, outputModalitiesText: 'decisions' },
    ]);
    expect(captured?.url).toBe('https://api.commandcode.ai/provider/v1/systemone');
  });

  test('chat probe honours use-max-completion-tokens', async () => {
    const { captured } = await runTest([{ name: 'gpt-6', useMaxCompletionTokens: true }]);

    const body = JSON.parse(captured?.data ?? '{}');
    expect(body.max_completion_tokens).toBe(5);
    expect(body.max_tokens).toBeUndefined();
  });
});

describe('Codex Decisions connectivity test', () => {
  async function runCodexTest(baseUrl: string, models: UseConnectivityTestArgs['models']) {
    let captured: ApiCallRequest | undefined;
    requestSpy = spyOn(apiCallApi, 'request').mockImplementation(async (req) => {
      captured = req;
      return { statusCode: 200, header: {}, bodyText: '', body: {} };
    });
    const hook = captureHook(() =>
      useConnectivityTest(
        { brand: 'codex', baseUrl, apiKey: 'sk-test', models, formHeaders: [] },
        messages
      )
    );
    await hook.runCodex();
    return captured;
  }

  test('decisions models hit <base>/decisions, defaulting to OpenAI', async () => {
    const models = [{ name: 'gpt-6-luna', outputModalitiesText: 'decisions' }];
    expect((await runCodexTest('', models))?.url).toBe('https://api.openai.com/v1/decisions');
    requestSpy?.mockRestore();

    const captured = await runCodexTest('https://relay.example/v1', models);
    expect(captured?.url).toBe('https://relay.example/v1/decisions');
    expect(JSON.parse(captured?.data ?? '{}').questions[0].type).toBe('predicate');
  });

  test('other codex models keep /responses', async () => {
    const captured = await runCodexTest('https://api.openai.com/v1', [{ name: 'gpt-6' }]);
    expect(captured?.url).toBe('https://api.openai.com/v1/responses');
  });
});

test('OpenAI-compatible systemone flag is read, saved, and can be cleared', async () => {
  let stored: Record<string, unknown> = {
    name: 'commandcode',
    'base-url': 'https://api.commandcode.ai/provider/v1',
    keys: [{ 'api-key': 'cc-test' }],
    models: [{ name: 'typesafe/jev', alias: 'cc-jev', systemone: true }],
  };
  apiClient.get = (async () => ({
    'api-keys': { 'openai-compatibility': [stored] },
  })) as typeof apiClient.get;
  apiClient.put = (async (_path: string, value: Record<string, unknown>[]) => {
    stored = structuredClone(value[0]);
  }) as typeof apiClient.put;

  let config = normalizeProviderGroups([stored], true)[0] as OpenAIProviderConfig;
  expect(config.models![0].systemone).toBe(true);

  await providersApi.updateOpenAIProvider(config.name, 0, {
    ...config,
    models: [{ ...config.models![0], alias: 'jev' }],
  });
  expect(stored.models).toEqual([{ name: 'typesafe/jev', alias: 'jev', systemone: true }]);

  config = normalizeProviderGroups([stored], true)[0] as OpenAIProviderConfig;
  await providersApi.updateOpenAIProvider(config.name, 0, {
    ...config,
    models: [{ ...config.models![0], systemone: false }],
  });
  expect(stored.models).toEqual([{ name: 'typesafe/jev', alias: 'jev' }]);
});

test('a System One flag change invalidates earlier connectivity results', () => {
  const base = modelsSignature([{ name: 'typesafe/jev', alias: 'jev' }]);
  expect(modelsSignature([{ name: 'typesafe/jev', alias: 'jev', systemone: true }])).not.toBe(base);
  expect(
    modelsSignature([{ name: 'typesafe/jev', alias: 'jev', useMaxCompletionTokens: true }])
  ).not.toBe(base);
  expect(
    modelsSignature([{ name: 'typesafe/jev', alias: 'jev', outputModalitiesText: 'decisions' }])
  ).not.toBe(base);
});
