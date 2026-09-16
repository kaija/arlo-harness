import type { ProviderProfile } from '@arlo/shared';
import { describe, expect, it } from 'vitest';
import {
  parseGlobalSettings,
  parsePersonaConfig,
  resolveMcpServers,
  resolveModelBinding,
  type GlobalSettings,
  type GlobalSettingsInput,
} from '../src/index.js';

const openai: ProviderProfile = {
  id: 'openai-main',
  name: 'OpenAI',
  apiType: 'openai',
  apiKeyRef: 'openai-main',
  capabilities: { realtime: true, transcription: true },
};

const ollama: ProviderProfile = {
  id: 'ollama',
  name: 'Local Ollama',
  apiType: 'openai_compatible',
  baseUrl: 'http://127.0.0.1:11434/v1',
  apiKeyRef: 'ollama',
  capabilities: { realtime: false, transcription: false },
};

function settings(input: GlobalSettingsInput): GlobalSettings {
  const result = parseGlobalSettings(input);
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.value;
}

describe('global settings', () => {
  it('fills defaults', () => {
    expect(settings({})).toEqual({ providers: [], orchestrator: {}, mcpServerTemplates: {} });
  });

  it('rejects duplicate provider ids and bindings to unknown providers', () => {
    const result = parseGlobalSettings({
      providers: [openai, openai],
      defaultBinding: { providerId: 'missing', model: 'gpt-5-mini' },
      orchestrator: { modelBinding: { providerId: 'also-missing', model: 'gpt-5' } },
    });

    expect(result.ok).toBe(false);
    expect(!result.ok && result.issues.map((issue) => issue.path).sort()).toEqual([
      'defaultBinding.providerId',
      'orchestrator.modelBinding.providerId',
      'providers.1.id',
    ]);
  });

  it('validates provider profiles and MCP template names', () => {
    const result = parseGlobalSettings({
      providers: [{ ...ollama, baseUrl: undefined }],
      mcpServerTemplates: { 'git.hub': { transport: 'stdio', command: 'gh-mcp' } },
    });
    expect(!result.ok && result.issues.map((issue) => issue.path).sort()).toEqual([
      'mcpServerTemplates.git.hub',
      'providers.0.baseUrl',
    ]);
  });
});

describe('model binding resolution', () => {
  const global = settings({
    providers: [openai, ollama],
    defaultBinding: { providerId: 'openai-main', model: 'gpt-5-mini' },
    orchestrator: { modelBinding: { providerId: 'openai-main', model: 'gpt-5' } },
  });

  it('inherits the global default when the Agent has no override', () => {
    expect(resolveModelBinding(undefined, global)).toEqual({
      ok: true,
      value: {
        binding: { providerId: 'openai-main', model: 'gpt-5-mini' },
        profile: openai,
        source: 'global',
      },
    });
  });

  it('prefers the Persona or Orchestrator override', () => {
    const persona = parsePersonaConfig({
      id: 'coder',
      name: 'Coder',
      description: 'Writes code.',
      prompt: 'You write code.',
      modelBinding: { providerId: 'ollama', model: 'qwen3' },
    });
    if (!persona.ok) throw new Error('fixture');

    expect(resolveModelBinding(persona.value.modelBinding, global)).toMatchObject({
      ok: true,
      value: {
        binding: { providerId: 'ollama', model: 'qwen3' },
        profile: ollama,
        source: 'agent',
      },
    });
    expect(resolveModelBinding(global.orchestrator.modelBinding, global)).toMatchObject({
      ok: true,
      value: { binding: { model: 'gpt-5' }, source: 'agent' },
    });
  });

  it('fails without any binding or with an unknown provider', () => {
    expect(resolveModelBinding(undefined, settings({ providers: [openai] }))).toMatchObject({
      ok: false,
      issues: [{ path: 'defaultBinding' }],
    });
    expect(resolveModelBinding({ providerId: 'azure-eu', model: 'gpt-5' }, global)).toMatchObject({
      ok: false,
      issues: [{ path: 'modelBinding.providerId' }],
    });
  });
});

describe('MCP server resolution', () => {
  const templates = settings({
    mcpServerTemplates: {
      github: {
        transport: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-github'],
        env: { GITHUB_TOKEN_FILE: '/tmp/token' },
      },
      docs: { transport: 'streamable_http', url: 'https://mcp.example.com/mcp' },
    },
  }).mcpServerTemplates;

  it('expands references into per-Persona definitions and keeps inline servers', () => {
    const persona = parsePersonaConfig({
      id: 'coder',
      name: 'Coder',
      description: 'Writes code.',
      prompt: 'You write code.',
      mcpServers: [
        { ref: 'github' },
        { ref: 'docs' },
        { name: 'local-fs', transport: 'stdio', command: 'mcp-fs', cwd: './workdir' },
      ],
    });
    if (!persona.ok) throw new Error(JSON.stringify(persona.issues));

    expect(resolveMcpServers(persona.value.mcpServers, templates)).toEqual({
      ok: true,
      value: [
        {
          name: 'github',
          transport: 'stdio',
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-github'],
          env: { GITHUB_TOKEN_FILE: '/tmp/token' },
        },
        {
          name: 'docs',
          transport: 'streamable_http',
          url: 'https://mcp.example.com/mcp',
          headers: {},
        },
        {
          name: 'local-fs',
          transport: 'stdio',
          command: 'mcp-fs',
          args: [],
          env: {},
          cwd: './workdir',
        },
      ],
    });
  });

  it('reports unknown references, including inherited object keys', () => {
    expect(resolveMcpServers([{ ref: 'gitlab' }, { ref: 'toString' }], templates)).toEqual({
      ok: false,
      issues: [
        { path: 'mcpServers.0.ref', message: 'No global MCP server template named "gitlab".' },
        { path: 'mcpServers.1.ref', message: 'No global MCP server template named "toString".' },
      ],
    });
  });

  it('describes the form the author meant when an entry is invalid', () => {
    const base = { id: 'coder', name: 'Coder', description: 'd', prompt: 'p' };
    const withRef = parsePersonaConfig({ ...base, mcpServers: [{ ref: 'github', command: 'x' }] });
    const inline = parsePersonaConfig({
      ...base,
      mcpServers: [{ name: 'fs', transport: 'websocket', command: 'x' }],
    });
    const insecureUrl = parsePersonaConfig({
      ...base,
      mcpServers: [{ name: 'docs', transport: 'streamable_http', url: 'file:///etc/passwd' }],
    });

    expect(withRef).toMatchObject({ ok: false, issues: [{ path: 'mcpServers.0' }] });
    expect(inline).toMatchObject({ ok: false, issues: [{ path: 'mcpServers.0.transport' }] });
    expect(insecureUrl).toMatchObject({ ok: false, issues: [{ path: 'mcpServers.0.url' }] });
  });
});
