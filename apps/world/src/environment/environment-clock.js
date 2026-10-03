import { DEFAULT_ENVIRONMENT_TIME, resolveEnvironmentTime } from './environment-presets.js';

export function resolveEnvironmentRuntimeTime(searchParams, { previewHost = false } = {}) {
  if (!previewHost) return DEFAULT_ENVIRONMENT_TIME;
  const requested = searchParams?.get?.('envTime');
  return requested ? resolveEnvironmentTime(requested) : DEFAULT_ENVIRONMENT_TIME;
}
