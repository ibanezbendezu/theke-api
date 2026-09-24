import { describe, expect, it, vi } from 'vitest';
import { withSerializationRetry } from '../src/infrastructure/database/serialization-retry.js';

describe('reintento serializable', () => {
  it('repite la transacción completa ante 40001 anidado', async () => {
    const operation = vi.fn().mockRejectedValueOnce({ cause: { code: '40001' } }).mockResolvedValue('guardado');
    await expect(withSerializationRetry(operation)).resolves.toBe('guardado');
    expect(operation).toHaveBeenCalledTimes(2);
  });
  it('no oculta errores de dominio ni insiste indefinidamente', async () => {
    const domain = vi.fn().mockRejectedValue(new Error('conflicto de revisión'));
    await expect(withSerializationRetry(domain)).rejects.toThrow('conflicto de revisión');
    expect(domain).toHaveBeenCalledTimes(1);
    const exhausted = vi.fn().mockRejectedValue({ code: '40001' });
    await expect(withSerializationRetry(exhausted)).rejects.toMatchObject({ code: '40001' });
    expect(exhausted).toHaveBeenCalledTimes(3);
  });
});
