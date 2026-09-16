import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Agent, tool } from '@openai/agents-core';
import { OpenAIChatCompletionsModel, OpenAIResponsesModel } from '@openai/agents-openai';
import type { ProviderProfile } from '@arlo/shared';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  AgentRunner,
  createModelProvider,
  createOpenAIClient,
  ModelConfig,
  OPENAI_DEFAULT_BASE_URL,
  usesResponsesApi,
  type AgentRunOutcome,
} from '../src/index.js';

/*
 * These tests run the real OpenAI client against a local stub to lock the
 * request shape each apiType produces: path, auth header, and streaming. They
 * do not show that any real endpoint accepts these requests (T07 acceptance:
 * a mock is not a compatibility claim).
 */

interface RecordedRequest {
  method: string;
  url: string;
  headers: IncomingHttpHeaders;
  body: Record<string, unknown>;
}

let server: Server;
let origin: string;
const requests: RecordedRequest[] = [];
let chatTurns: string[][] = [];

function sse(
  res: import('node:http').ServerResponse,
  events: { event?: string; data: unknown }[],
): void {
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  for (const { event, data } of events) {
    if (event !== undefined) res.write(`event: ${event}\n`);
    res.write(`data: ${typeof data === 'string' ? data : JSON.stringify(data)}\n\n`);
  }
  res.end();
}

function chatChunk(delta: Record<string, unknown>, finishReason: string | null = null): unknown {
  return {
    id: 'chatcmpl-1',
    object: 'chat.completion.chunk',
    created: 1,
    model: 'stub',
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  };
}

const chatScripts: Record<string, () => unknown[]> = {
  text: () => [
    chatChunk({ role: 'assistant', content: 'Hello ' }),
    chatChunk({ content: 'from chat.' }),
    {
      ...(chatChunk({}, 'stop') as object),
      usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
    },
    '[DONE]',
  ],
  tool: () => [
    chatChunk({
      role: 'assistant',
      tool_calls: [
        { index: 0, id: 'call_abc', type: 'function', function: { name: 'lookup', arguments: '' } },
      ],
    }),
    chatChunk({ tool_calls: [{ index: 0, function: { arguments: '{"query":"tides"}' } }] }),
    chatChunk({}, 'tool_calls'),
    '[DONE]',
  ],
};

function responsesEvents(text: string): { event: string; data: unknown }[] {
  const base = { id: 'resp_1', object: 'response', created_at: 1, model: 'stub', output: [] };
  const message = {
    type: 'message',
    id: 'msg_1',
    status: 'completed',
    role: 'assistant',
    content: [{ type: 'output_text', text, annotations: [] }],
  };
  return [
    {
      event: 'response.created',
      data: {
        type: 'response.created',
        sequence_number: 0,
        response: { ...base, status: 'in_progress' },
      },
    },
    {
      event: 'response.output_text.delta',
      data: {
        type: 'response.output_text.delta',
        sequence_number: 1,
        item_id: 'msg_1',
        output_index: 0,
        content_index: 0,
        delta: text,
      },
    },
    {
      event: 'response.completed',
      data: {
        type: 'response.completed',
        sequence_number: 2,
        response: {
          ...base,
          status: 'completed',
          output: [message],
          usage: {
            input_tokens: 4,
            output_tokens: 2,
            total_tokens: 6,
            input_tokens_details: { cached_tokens: 0 },
            output_tokens_details: { reasoning_tokens: 0 },
          },
        },
      },
    },
  ];
}

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      const body = raw === '' ? {} : (JSON.parse(raw) as Record<string, unknown>);
      requests.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers, body });
      if (req.url?.includes('/chat/completions')) {
        const script = chatTurns.shift() ?? ['text'];
        sse(
          res,
          script
            .flatMap((name) => (chatScripts[name] as () => unknown[])())
            .map((data) => ({ data })),
        );
      } else if (req.url?.includes('/responses')) {
        sse(res, responsesEvents('Hello from responses.'));
      } else {
        res.writeHead(404).end();
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

afterEach(() => {
  requests.length = 0;
  chatTurns = [];
  delete process.env.OPENAI_BASE_URL;
  delete process.env.OPENAI_ORG_ID;
  delete process.env.OPENAI_PROJECT_ID;
  delete process.env.OPENAI_API_KEY;
  delete process.env.AZURE_OPENAI_API_KEY;
});

function profileFor(apiType: ProviderProfile['apiType'], baseUrl?: string): ProviderProfile {
  return {
    id: `${apiType}-stub`,
    name: apiType,
    apiType,
    ...(baseUrl === undefined ? {} : { baseUrl }),
    apiKeyRef: 'ref',
    ...(apiType === 'azure_openai' ? { azure: { apiVersion: '2024-10-21' } } : {}),
    capabilities: { realtime: false, transcription: false },
  };
}

async function runAgainst(
  profile: ProviderProfile,
  model: string,
  agent = new Agent({ name: 'Wire test', instructions: 'Answer briefly.' }),
): Promise<AgentRunOutcome> {
  const config = new ModelConfig();
  config.configure({
    kind: 'control',
    type: 'provider/configure',
    binding: { providerId: profile.id, model },
    profile,
    apiKey: 'sk-arlo-test',
  });
  return new AgentRunner(config).run({ agent, input: 'hi' });
}

describe('Provider selection', () => {
  it('uses Responses only for the official OpenAI API type', async () => {
    expect(usesResponsesApi('openai')).toBe(true);
    expect(usesResponsesApi('openai_compatible')).toBe(false);
    expect(usesResponsesApi('azure_openai')).toBe(false);

    const models = await Promise.all([
      createModelProvider(profileFor('openai'), 'k').getModel('gpt-5-mini'),
      createModelProvider(profileFor('openai_compatible', origin), 'k').getModel('qwen3'),
      createModelProvider(profileFor('azure_openai', origin), 'k').getModel('my-deployment'),
    ]);
    expect(models[0]).toBeInstanceOf(OpenAIResponsesModel);
    expect(models[1]).toBeInstanceOf(OpenAIChatCompletionsModel);
    expect(models[2]).toBeInstanceOf(OpenAIChatCompletionsModel);
  });

  it('ignores OPENAI_* environment variables when building clients', () => {
    process.env.OPENAI_BASE_URL = 'https://attacker.example/v1';
    process.env.OPENAI_ORG_ID = 'org-from-env';
    process.env.OPENAI_PROJECT_ID = 'proj-from-env';

    const openai = createOpenAIClient(profileFor('openai'), 'sk-configured');
    const azure = createOpenAIClient(
      profileFor('azure_openai', 'https://res.openai.azure.com/'),
      'az-key',
    );

    expect(openai.baseURL).toBe(OPENAI_DEFAULT_BASE_URL);
    expect(openai.apiKey).toBe('sk-configured');
    expect(openai.organization).toBeNull();
    expect(openai.project).toBeNull();
    expect(azure.baseURL).toBe('https://res.openai.azure.com/openai');
  });
});

describe('request shape against a local stub (not a compatibility claim)', () => {
  it('openai_compatible streams Chat Completions with a bearer key', async () => {
    process.env.OPENAI_BASE_URL = 'http://127.0.0.1:9/v1';

    const outcome = await runAgainst(profileFor('openai_compatible', `${origin}/v1`), 'qwen3');

    expect(outcome).toEqual({ status: 'completed', finalOutput: 'Hello from chat.' });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { authorization: 'Bearer sk-arlo-test' },
      body: { model: 'qwen3', stream: true },
    });
  });

  it('openai_compatible carries a tool call and its output over Chat Completions', async () => {
    chatTurns = [['tool'], ['text']];
    const lookup = tool({
      name: 'lookup',
      description: 'Look up a fact.',
      parameters: z.object({ query: z.string() }),
      execute: ({ query }) => `high tide for ${query}`,
    });

    const outcome = await runAgainst(
      profileFor('openai_compatible', `${origin}/v1`),
      'qwen3',
      new Agent({ name: 'Wire test', instructions: 'Use tools.', tools: [lookup] }),
    );

    expect(outcome).toEqual({ status: 'completed', finalOutput: 'Hello from chat.' });
    expect(requests).toHaveLength(2);
    expect(requests[0]?.body.tools).toMatchObject([
      { type: 'function', function: { name: 'lookup' } },
    ]);
    expect(requests[1]?.body.messages).toContainEqual({
      role: 'tool',
      tool_call_id: 'call_abc',
      content: 'high tide for tides',
    });
  });

  it('azure_openai routes to the deployment with api-version and an api-key header', async () => {
    process.env.AZURE_OPENAI_API_KEY = 'from-env';

    const outcome = await runAgainst(profileFor('azure_openai', `${origin}/`), 'gpt-5-mini-prod');

    expect(outcome).toEqual({ status: 'completed', finalOutput: 'Hello from chat.' });
    expect(requests[0]?.url).toBe(
      '/openai/deployments/gpt-5-mini-prod/chat/completions?api-version=2024-10-21',
    );
    expect(requests[0]?.headers['api-key']).toBe('sk-arlo-test');
    expect(requests[0]?.headers.authorization).toBeUndefined();
  });

  it('openai streams the Responses API', async () => {
    const outcome = await runAgainst(profileFor('openai', `${origin}/v1`), 'gpt-5-mini');

    expect(outcome).toEqual({ status: 'completed', finalOutput: 'Hello from responses.' });
    expect(requests[0]).toMatchObject({
      method: 'POST',
      url: '/v1/responses',
      headers: { authorization: 'Bearer sk-arlo-test' },
      body: { model: 'gpt-5-mini', stream: true },
    });
  });
});
