import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

const workflow = readFileSync('.github/workflows/ci.yml', 'utf8').replace(/\r\n/g, '\n');
const policy = workflow.split('  repository-policy:\n')[1]?.split('  verify:\n')[0] ?? '';
const source = (policy.split('          script: |\n')[1] ?? '')
  .split('\n')
  .map((line) => line.replace(/^ {12}/, ''))
  .join('\n');
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (
  ...parameters: string[]
) => (...args: unknown[]) => Promise<void>;

async function evaluate(
  filenames: { filename: string; previous_filename?: string }[],
  trusted = false,
  apiError = false,
) {
  const createCommitStatus = vi.fn().mockResolvedValue({});
  const paginate = vi.fn().mockImplementation(async () => {
    if (apiError) throw new Error('API unavailable');
    return filenames;
  });
  const setFailed = vi.fn();
  const context = {
    repo: { owner: 'jbcom', repo: 'gesture-audio' },
    serverUrl: 'https://github.com',
    runId: 123,
    sha: 'default-branch-sha',
    payload: {
      pull_request: {
        number: 42,
        head: {
          sha: 'pr-head-sha',
          repo: { full_name: trusted ? 'jbcom/gesture-audio' : 'contributor/gesture-audio' },
        },
      },
    },
  };
  const run = new AsyncFunction('github', 'context', 'core', source);
  let error: unknown;
  try {
    await run(
      { rest: { repos: { createCommitStatus }, pulls: { listFiles: vi.fn() } }, paginate },
      context,
      { setFailed },
    );
  } catch (caught) {
    error = caught;
  }
  return { createCommitStatus, paginate, setFailed, error };
}

describe('trusted repository policy', () => {
  it('keeps the required status distinct from conditionally skipped job names', () => {
    expect(policy).toContain('name: Trusted repository policy evaluation');
    expect(workflow).not.toMatch(/^\s+name: Repository Policy \/ gate$/m);
    expect(policy).toContain('statuses: write');
    expect(policy).not.toContain('actions/checkout');
  });

  it('reports success against the PR head for ordinary fork changes', async () => {
    const result = await evaluate([{ filename: 'src/init.ts' }]);
    expect(result.error).toBeUndefined();
    expect(result.setFailed).not.toHaveBeenCalled();
    expect(result.createCommitStatus.mock.calls.map(([status]) => status.state)).toEqual([
      'pending',
      'success',
    ]);
    for (const [status] of result.createCommitStatus.mock.calls) {
      expect(status).toMatchObject({
        owner: 'jbcom',
        repo: 'gesture-audio',
        sha: 'pr-head-sha',
        context: 'Repository Policy / gate',
      });
    }
  });

  it.each([
    '.github/workflows/ci.yml',
    '.github/actions/custom/action.yml',
    '.github/dependabot.yml',
    '.coderabbit.yaml',
    'sonar-project.properties',
    'release-please-config.json',
    '.release-please-manifest.json',
    'docs/sourcey.config.ts',
    'docs/package.json',
    'scripts/apply-branch-ruleset.mjs',
  ])('rejects a fork change to %s', async (filename) => {
    const result = await evaluate([{ filename }]);
    expect(result.setFailed).toHaveBeenCalledOnce();
    expect(result.createCommitStatus.mock.calls.map(([status]) => status.state)).toEqual([
      'pending',
      'failure',
    ]);
    expect(result.createCommitStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({ sha: 'pr-head-sha' }),
    );
  });

  it('rejects renaming a protected file outside its protected path', async () => {
    const result = await evaluate([
      { filename: 'examples/admin.mjs', previous_filename: 'scripts/apply-branch-ruleset.mjs' },
    ]);
    expect(result.setFailed).toHaveBeenCalledOnce();
    expect(result.createCommitStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({ state: 'failure' }),
    );
  });

  it('allows trusted upstream control-plane changes without reading fork files', async () => {
    const result = await evaluate([{ filename: '.github/workflows/ci.yml' }], true);
    expect(result.paginate).not.toHaveBeenCalled();
    expect(result.setFailed).not.toHaveBeenCalled();
    expect(result.createCommitStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({ state: 'success' }),
    );
  });

  it('fails closed on an API error', async () => {
    const result = await evaluate([], false, true);
    expect(result.error).toBeInstanceOf(Error);
    expect(result.createCommitStatus.mock.calls.map(([status]) => status.state)).toEqual([
      'pending',
      'error',
    ]);
  });
});
