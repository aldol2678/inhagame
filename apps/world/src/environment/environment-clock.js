import { DEFAULT_ENVIRONMENT_TIME, resolveEnvironmentTime } from './environment-presets.js';
import { DEFAULT_ENVIRONMENT_WEATHER, resolveEnvironmentWeather } from './environment-weather.js';

export function resolveEnvironmentRuntimeTime(searchParams, { previewHost = false } = {}) {
  if (!previewHost) return DEFAULT_ENVIRONMENT_TIME;
  const requested = searchParams?.get?.('envTime');
  return requested ? resolveEnvironmentTime(requested) : DEFAULT_ENVIRONMENT_TIME;
}

export function resolveEnvironmentRuntimeWeather(searchParams, { previewHost = false } = {}) {
  if (!previewHost) return DEFAULT_ENVIRONMENT_WEATHER;
  const requested = searchParams?.get?.('envWeather');
  return requested ? resolveEnvironmentWeather(requested) : DEFAULT_ENVIRONMENT_WEATHER;
}
