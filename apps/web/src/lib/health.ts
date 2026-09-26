export type HealthStatus = { status: 'ok' } | { status: 'error' };

export function healthStatus(status: HealthStatus['status']): HealthStatus {
  return { status };
}
