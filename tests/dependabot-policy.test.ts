import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

const workflow = readFileSync('.github/workflows/repository-policy.yml', 'utf8').replace(
  /\r\n/g,
  '\n',
);
const source = workflow
  .split('          script: |\n')[1]
  ?.split('\n')
  .map((line) => line.replace(/^ {12}/, ''))
  .join('\n');
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (
  ...parameters: string[]
) => (...args: unknown[]) => Promise<void>;

async function evaluate(
  options: {
    event?: string;
    conclusion?: string;
    foreignRepo?: boolean;
    staleHead?: boolean;
    fallback?: boolean;
    race?: boolean;
    humanActor?: boolean;
  } = {},
) {
  const createCommitStatus = vi.fn().mockResolvedValue({});
  const pr = {
    number: 42,
    state: 'open',
    user: { login: 'dependabot[bot]' },
    head: {
      sha: options.staleHead ? 'new-head' : 'head-sha',
      repo: {
        full_name: options.foreignRepo ? 'contributor/gesture-audio' : 'jbcom/gesture-audio',
      },
    },
    merge_commit_sha: 'merge-sha',
  };
  const get = vi.fn().mockResolvedValue({ data: pr });
  if (options.race) {
    get
      .mockResolvedValue({ data: { ...pr, head: { ...pr.head, sha: 'new-head' } } })
      .mockResolvedValueOnce({ data: pr })
      .mockResolvedValueOnce({ data: pr });
  }
  const paginate = vi.fn().mockResolvedValue([pr]);
  const context = {
    repo: { owner: 'jbcom', repo: 'gesture-audio' },
    serverUrl: 'https://github.com',
    runId: 123,
    payload: {
      workflow_run: {
        event: options.event ?? 'pull_request_target',
        conclusion: options.conclusion ?? 'success',
        actor: { login: options.humanActor ? 'maintainer' : 'dependabot[bot]' },
        head_sha: 'head-sha',
        head_branch: 'dependabot/npm_and_yarn/example',
        pull_requests: options.fallback ? [] : [{ number: 42 }],
      },
    },
  };
  let error: unknown;
  try {
    await new AsyncFunction('github', 'context', 'setTimeout', source ?? '')(
      { rest: { repos: { createCommitStatus }, pulls: { get, list: vi.fn() } }, paginate },
      context,
      (callback: () => void) => callback(),
    );
  } catch (caught) {
    error = caught;
  }
  return { createCommitStatus, get, paginate, error };
}

function assertStates(result: Awaited<ReturnType<typeof evaluate>>, finalState: string) {
  const statuses = result.createCommitStatus.mock.calls.map(([status]) => status);
  expect([...new Set(statuses.map((status) => status.sha))].sort()).toEqual([
    'head-sha',
    'merge-sha',
  ]);
  for (const sha of ['head-sha', 'merge-sha']) {
    const states = statuses.filter((status) => status.sha === sha).map((status) => status.state);
    expect(states[0]).toBe('pending');
    expect(states.at(-1)).toBe(finalState);
  }
  for (const status of statuses) {
    expect(status).toMatchObject({
      owner: 'jbcom',
      repo: 'gesture-audio',
      context: 'Repository Policy / gate',
    });
  }
}

describe('trusted Dependabot policy reporter', () => {
  it('uses a privileged follow-up without checking out PR content', async () => {
    expect(workflow).toContain('workflow_run:');
    expect(workflow).toContain('statuses: write');
    expect(workflow).not.toContain('actions/checkout');
    const result = await evaluate();
    expect(result.error).toBeUndefined();
    assertStates(result, 'success');
  });

  it.each([{ event: 'pull_request' }, { conclusion: 'failure' }])(
    'ignores an untrusted or failed parent run: %o',
    async (options) => {
      const result = await evaluate(options);
      expect(result.get).not.toHaveBeenCalled();
      expect(result.createCommitStatus).not.toHaveBeenCalled();
    },
  );

  it.each([{ foreignRepo: true }, { staleHead: true }])(
    'does not approve foreign or stale PR metadata: %o',
    async (options) => {
      const result = await evaluate(options);
      expect(result.createCommitStatus).not.toHaveBeenCalled();
    },
  );

  it('uses verified API metadata when run PR associations are empty', async () => {
    const result = await evaluate({ fallback: true });
    expect(result.paginate).toHaveBeenCalledOnce();
    assertStates(result, 'success');
  });

  it('handles a maintainer editing a Dependabot PR', async () => {
    const result = await evaluate({ humanActor: true });
    assertStates(result, 'success');
  });

  it('fails closed if the PR changes during the follow-up', async () => {
    const result = await evaluate({ race: true });
    expect(result.error).toBeInstanceOf(Error);
    assertStates(result, 'error');
  });
});
