export const CHECK_TIMEOUT_MS = 2000;

export interface HealthMetrics {
  clients?: number;
  waiting?: number;
  failed?: number;
}

export interface ServiceHealth extends HealthMetrics {
  status: 'up' | 'down';
  responseTimeMs: number;
  checkedAt: string;
  error?: string;
}

export interface HealthDetails {
  status: 'ok' | 'degraded';
  checkedAt: string;
  services: {
    postgres: ServiceHealth;
    redis: ServiceHealth;
    storage: ServiceHealth;
    websocket: ServiceHealth;
    queue: ServiceHealth;
  };
}

export function toErrorMessage(error: unknown): string {
  if (error instanceof AggregateError) {
    const parts = error.errors.map((item) => toErrorMessage(item)).filter((part) => part !== '');
    if (parts.length > 0) {
      return parts.join('; ');
    }
  }
  if (error instanceof Error) {
    const cause =
      error.cause instanceof Error && error.cause.message !== '' ? error.cause.message : undefined;
    if (error.message !== '' && cause !== undefined) {
      return `${error.message}: ${cause}`;
    }
    if (error.message !== '') {
      return error.message;
    }
  }
  return String(error);
}

export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${label} check timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  const guarded = promise.then(
    (value) => value,
    (error: unknown) => {
      throw error instanceof Error ? error : new Error(toErrorMessage(error));
    },
  );
  guarded.catch(() => undefined);

  try {
    return await Promise.race([guarded, timeout]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export abstract class ServiceChecker {
  async check(): Promise<ServiceHealth> {
    const started = Date.now();
    try {
      const details = (await this.probe()) ?? {};
      return {
        ...details,
        status: 'up',
        responseTimeMs: Date.now() - started,
        checkedAt: new Date().toISOString(),
      };
    } catch (error) {
      return {
        status: 'down',
        responseTimeMs: Date.now() - started,
        checkedAt: new Date().toISOString(),
        error: toErrorMessage(error),
      };
    }
  }

  protected abstract probe(): Promise<HealthMetrics | void>;
}
