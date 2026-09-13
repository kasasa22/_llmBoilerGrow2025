export interface AppEnv {
  env: string;
  modelName: string;
  inngestDashboardUrl: string | null;
}

export function readEnv(): AppEnv {
  return {
    env: process.env.APP_ENV ?? process.env.NEXT_PUBLIC_ENV ?? 'dev',
    modelName:
      process.env.MODEL_NAME ?? process.env.NEXT_PUBLIC_MODEL_NAME ?? 'qwen3:8b',
    inngestDashboardUrl:
      process.env.INNGEST_DASHBOARD_URL ??
      process.env.NEXT_PUBLIC_INNGEST_DASHBOARD_URL ??
      null,
  };
}

export function serverBackendUrl(): string {
  return process.env.FLASK_INTERNAL_URL ?? 'http://flask:8080';
}
