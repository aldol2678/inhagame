const REPOSITORY = 'aldol2678/inhagame';
const BRANCH = 'main';
const PRODUCTION_URL = 'https://inhagame.app/campus/';
const GITHUB_MAIN_URL = 'https://api.github.com/repos/' + REPOSITORY + '/commits/' + BRANCH;

async function readGithubMain(fetcher = fetch) {
  try {
    const response = await fetcher(GITHUB_MAIN_URL, {
      method: 'GET',
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'INHAGAME-Status-Service/1.0',
        'X-GitHub-Api-Version': '2022-11-28'
      },
      signal: AbortSignal.timeout(1800)
    });
    if (!response.ok) {
      return { status: 'UNAVAILABLE', sha: null, reason: 'HTTP_' + response.status };
    }
    const body = await response.json();
    if (typeof body?.sha !== 'string' || !/^[a-f0-9]{40}$/.test(body.sha)) {
      return { status: 'UNAVAILABLE', sha: null, reason: 'INVALID_RESPONSE' };
    }
    return { status: 'READY', sha: body.sha, reason: null };
  } catch (error) {
    return { status: 'UNAVAILABLE', sha: null, reason: String(error?.name || 'FETCH_FAILED') };
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Vercel-CDN-Cache-Control', 'public, s-maxage=5, stale-while-revalidate=5');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).end();
  }

  const github = await readGithubMain();
  const deploymentSha = /^[a-f0-9]{40}$/.test(process.env.VERCEL_GIT_COMMIT_SHA || '')
    ? process.env.VERCEL_GIT_COMMIT_SHA
    : null;
  const environment = process.env.VERCEL_ENV || 'unknown';
  const productionServing = environment === 'production';
  const comparable = github.sha !== null && deploymentSha !== null;

  return res.status(200).json({
    schema: 'inha.dev-status/1',
    project: 'INHA WORLD',
    repository: REPOSITORY,
    branch: BRANCH,
    read_only: true,
    source_mode: 'LIVE',
    fetched_at: new Date().toISOString(),
    github: {
      status: github.status,
      main_sha: github.sha,
      reason: github.reason
    },
    deployment: {
      provider: 'vercel',
      environment,
      status: productionServing ? 'READY' : 'NON_PRODUCTION',
      production_url: PRODUCTION_URL,
      commit_sha: deploymentSha
    },
    current: {
      main_sha: github.sha,
      production_sha: productionServing ? deploymentSha : null,
      production_status: productionServing ? 'READY' : 'NON_PRODUCTION',
      main_matches_production: comparable && productionServing ? github.sha === deploymentSha : null
    },
    comparison_status: comparable && productionServing ? 'RESOLVED' : 'UNAVAILABLE'
  });
};

module.exports._test = { readGithubMain, REPOSITORY, BRANCH, GITHUB_MAIN_URL };
