export type GithubWorkflowDispatchResult = {
  ref: string;
  repository: string;
  workflowId: string;
};

const OHLQ_WORKFLOW_ID = 'ohlq-annual-sales.yml';
const DEFAULT_GITHUB_ACTIONS_REF = 'main';

const resolveRepository = () => {
  const explicitRepository = process.env.GITHUB_ACTIONS_REPOSITORY?.trim() || process.env.GITHUB_REPOSITORY?.trim();
  if (explicitRepository) return explicitRepository;

  const owner = process.env.VERCEL_GIT_REPO_OWNER?.trim();
  const repo = process.env.VERCEL_GIT_REPO_SLUG?.trim();
  if (owner && repo) return `${owner}/${repo}`;

  return 'echospirits/ohlq-field-crm';
};

export function getGithubActionsDispatchConfig() {
  const token = process.env.GITHUB_ACTIONS_DISPATCH_TOKEN?.trim();
  if (!token) return null;

  return {
    ref: process.env.GITHUB_ACTIONS_REF?.trim() || DEFAULT_GITHUB_ACTIONS_REF,
    repository: resolveRepository(),
    token,
    workflowId: process.env.GITHUB_ACTIONS_OHLQ_WORKFLOW_ID?.trim() || OHLQ_WORKFLOW_ID,
  };
}

export async function dispatchOhlqAnnualSalesWorkflow({ reportDate }: { reportDate: string }) {
  const config = getGithubActionsDispatchConfig();
  if (!config) return null;

  const response = await fetch(
    `https://api.github.com/repos/${config.repository}/actions/workflows/${encodeURIComponent(
      config.workflowId,
    )}/dispatches`,
    {
      body: JSON.stringify({
        inputs: {
          days: '1',
          reportDate,
        },
        ref: config.ref,
      }),
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${config.token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'ohlq-field-crm',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      method: 'POST',
    },
  );

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(
      `Unable to queue GitHub Actions OHLQ workflow: ${response.status} ${response.statusText} ${body}`.trim(),
    );
  }

  return {
    ref: config.ref,
    repository: config.repository,
    workflowId: config.workflowId,
  } satisfies GithubWorkflowDispatchResult;
}
