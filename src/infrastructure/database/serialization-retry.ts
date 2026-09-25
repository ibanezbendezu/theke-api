import { setTimeout as delay } from 'node:timers/promises';

function serializationFailure(error: unknown): boolean {
  let current = error;
  for (let depth = 0; depth < 4 && current && typeof current === 'object'; depth++) {
    if ('code' in current && (current.code === '40001' || current.code === '40P01')) return true;
    current = 'cause' in current ? current.cause : null;
  }
  return false;
}

export async function withSerializationRetry<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await operation(); }
    catch (error) {
      if (attempt >= 2 || !serializationFailure(error)) throw error;
      await delay(20 * 2 ** attempt);
    }
  }
}
