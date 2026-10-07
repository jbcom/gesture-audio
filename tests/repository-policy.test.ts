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
  options: {
    missingMerge?: boolean;
    changedHead?: boolean;
    delayedMerge?: boolean;
    changedDuringRead?: boolean;
  } = {},
) {
  const createCommitStatus = vi.fn().mockResolvedValue({});
  const paginate = vi.fn().mockImplementation(async () => {
    if (apiError) throw new Error('API unavailable');
    return filenames;
  });
  const setFailed = vi.fn();
  const get = vi.fn().mockResolvedValue({
    data: {
      head: { sha: options.changedHead ? 'new-pr-head-sha' : 'pr-head-sha' },
      merge_commit_sha: options.missingMerge ? null : 'pr-test-merge-sha',
    },
  });
  if (options.delayedMerge) {
    get.mockResolvedValueOnce({ data: { head: { sha: 'pr-head-sha' }, merge_commit_sha: null } });
  }
  if (options.changedDuringRead) {
    get
      .mockResolvedValue({
        data: { head: { sha: 'new-pr-head-sha' }, merge_commit_sha: 'new-merge' },
      })
      .mockResolvedValueOnce({
        data: { head: { sha: 'pr-head-sha' }, merge_commit_sha: 'pr-test-merge-sha' },
      });
  }
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
  const run = new AsyncFunction('github', 'context', 'core', 'setTimeout', source);
  let error: unknown;
  try {
    await run(
      { rest: { repos: { createCommitStatus }, pulls: { listFiles: vi.fn(), get } }, paginate },
      context,
      { setFailed },
      (callback: () => void) => callback(),
    );
  } catch (caught) {
    error = caught;
  }
  return { createCommitStatus, paginate, setFailed, error, get };
}

function assertReports(
  result: Awaited<ReturnType<typeof evaluate>>,
  finalState: string,
  expectedShas = ['pr-head-sha', 'pr-test-merge-sha'],
) {
  const reports = result.createCommitStatus.mock.calls.map(([status]) => status);
  expect([...new Set(reports.map((status) => status.sha))].sort()).toEqual(
    [...expectedShas].sort(),
  );
  for (const sha of expectedShas) {
    const states = reports.filter((status) => status.sha === sha).map((status) => status.state);
    expect(states[0]).toBe('pending');
    expect(states.at(-1)).toBe(finalState);
  }
  for (const status of reports) {
    expect(status).toMatchObject({
      owner: 'jbcom',
      repo: 'gesture-audio',
      context: 'Repository Policy / gate',
    });
  }
}

describe('trusted repository policy', () => {
  it('keeps the required status distinct from conditionally skipped job names', () => {
    expect(policy).toContain('name: Trusted repository policy evaluation');
    expect(workflow).not.toMatch(/^\s+name: Repository Policy \/ gate$/m);
    expect(policy).toContain('statuses: write');
    expect(policy).not.toContain('actions/checkout');
  });

  it('reports success against both PR head and test merge for ordinary fork changes', async () => {
    const result = await evaluate([{ filename: 'src/init.ts' }]);
    expect(result.error).toBeUndefined();
    expect(result.setFailed).not.toHaveBeenCalled();
    assertReports(result, 'success');
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
    assertReports(result, 'failure');
  });

  it('rejects renaming a protected file outside its protected path', async () => {
    const result = await evaluate([
      { filename: 'examples/admin.mjs', previous_filename: 'scripts/apply-branch-ruleset.mjs' },
    ]);
    expect(result.setFailed).toHaveBeenCalledOnce();
    assertReports(result, 'failure');
  });

  it('allows trusted upstream control-plane changes without reading fork files', async () => {
    const result = await evaluate([{ filename: '.github/workflows/ci.yml' }], true);
    expect(result.paginate).not.toHaveBeenCalled();
    expect(result.setFailed).not.toHaveBeenCalled();
    assertReports(result, 'success');
  });

  it('fails closed on an API error', async () => {
    const result = await evaluate([], false, true);
    expect(result.error).toBeInstanceOf(Error);
    assertReports(result, 'error');
  });

  it('waits for GitHub to compute a transiently unavailable test merge', async () => {
    const result = await evaluate([], true, false, { delayedMerge: true });
    expect(result.get).toHaveBeenCalledTimes(3);
    assertReports(result, 'success');
  });

  it('fails closed when no test merge is available after bounded retries', async () => {
    const result = await evaluate([], true, false, { missingMerge: true });
    expect(result.get).toHaveBeenCalledTimes(5);
    expect(result.error).toBeInstanceOf(Error);
    assertReports(result, 'error', ['pr-head-sha']);
  });

  it('never reports success against a newer PR head or its test merge', async () => {
    const result = await evaluate([], true, false, { changedHead: true });
    expect(result.error).toBeInstanceOf(Error);
    expect(result.paginate).not.toHaveBeenCalled();
    assertReports(result, 'error', ['pr-head-sha']);
  });

  it('fails closed if the PR changes while its files are being checked', async () => {
    const result = await evaluate([], false, false, { changedDuringRead: true });
    expect(result.error).toBeInstanceOf(Error);
    assertReports(result, 'error');
  });
});
