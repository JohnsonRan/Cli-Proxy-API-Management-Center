import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { apiCallApi, type ApiCallRequest } from '../src/services/api/apiCall';
import {
  useConnectivityTest,
  type UseConnectivityTestArgs,
  type ConnectivityErrorMessages,
} from '../src/features/providers/sheets/forms/useConnectivityTest';

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
const success = { statusCode: 200, header: {}, bodyText: '', body: { data: [] } };
let requestSpy: ReturnType<typeof spyOn<typeof apiCallApi, 'request'>> | undefined;
afterEach(() => requestSpy?.mockRestore());

describe('OpenAI-compatible embedding and rerank connectivity test routing', () => {
  test('routes embedding model to /embeddings with input payload', async () => {
    let capturedReq: ApiCallRequest | undefined;
    requestSpy = spyOn(apiCallApi, 'request').mockImplementation(async (req) => {
      capturedReq = req;
      return success;
    });

    const args: UseConnectivityTestArgs = {
      brand: 'openaiCompatibility',
      baseUrl: 'https://api.siliconflow.cn/v1',
      apiKeyEntries: [{ apiKey: 'sk-test' }],
      models: [{ name: 'BAAI/bge-m3', embedding: true }],
      formHeaders: [],
    };

    const hook = captureHook(() => useConnectivityTest(args, messages));
    const ok = await hook.runOpenAIKey(0);

    expect(ok).toBe(true);
    expect(capturedReq?.url).toBe('https://api.siliconflow.cn/v1/embeddings');
    const parsedData = JSON.parse(capturedReq?.data ?? '{}');
    expect(parsedData.model).toBe('BAAI/bge-m3');
    expect(parsedData.input).toBe('Hello');
    expect(parsedData.messages).toBeUndefined();
  });

  test('routes rerank model to /rerank with query and documents payload', async () => {
    let capturedReq: ApiCallRequest | undefined;
    requestSpy = spyOn(apiCallApi, 'request').mockImplementation(async (req) => {
      capturedReq = req;
      return success;
    });

    const args: UseConnectivityTestArgs = {
      brand: 'openaiCompatibility',
      baseUrl: 'https://api.siliconflow.cn/v1',
      apiKeyEntries: [{ apiKey: 'sk-test' }],
      models: [{ name: 'BAAI/bge-reranker-v2-m3', rerank: true }],
      formHeaders: [],
    };

    const hook = captureHook(() => useConnectivityTest(args, messages));
    const ok = await hook.runOpenAIKey(0);

    expect(ok).toBe(true);
    expect(capturedReq?.url).toBe('https://api.siliconflow.cn/v1/rerank');
    const parsedData = JSON.parse(capturedReq?.data ?? '{}');
    expect(parsedData.model).toBe('BAAI/bge-reranker-v2-m3');
    expect(parsedData.query).toBe('Hello');
    expect(Array.isArray(parsedData.documents)).toBe(true);
    expect(parsedData.messages).toBeUndefined();
  });

  test('routes standard chat model to /chat/completions with messages payload', async () => {
    let capturedReq: ApiCallRequest | undefined;
    requestSpy = spyOn(apiCallApi, 'request').mockImplementation(async (req) => {
      capturedReq = req;
      return success;
    });

    const args: UseConnectivityTestArgs = {
      brand: 'openaiCompatibility',
      baseUrl: 'https://api.siliconflow.cn/v1',
      apiKeyEntries: [{ apiKey: 'sk-test' }],
      models: [{ name: 'deepseek-ai/DeepSeek-V3' }],
      formHeaders: [],
    };

    const hook = captureHook(() => useConnectivityTest(args, messages));
    const ok = await hook.runOpenAIKey(0);

    expect(ok).toBe(true);
    expect(capturedReq?.url).toBe('https://api.siliconflow.cn/v1/chat/completions');
    const parsedData = JSON.parse(capturedReq?.data ?? '{}');
    expect(parsedData.model).toBe('deepseek-ai/DeepSeek-V3');
    expect(parsedData.messages).toBeDefined();
    expect(parsedData.input).toBeUndefined();
  });
});
