import { describe, expect, it } from 'vitest';
import { PublicCommentsService } from '../src/modules/diagrams/public-comments.service.js';
import { commentRateLimitRetryAfterSeconds, publicCommentRatePolicy } from '../src/modules/diagrams/public-comment-rate-policy.js';

describe('política de comentarios públicos', () => {
  const below = {
    sessionMinute: publicCommentRatePolicy.sessionMinute - 1,
    sessionHour: publicCommentRatePolicy.sessionHour - 1,
    ipMinute: publicCommentRatePolicy.ipMinute - 1,
    ipHour: publicCommentRatePolicy.ipHour - 1,
    shareHour: publicCommentRatePolicy.shareHour - 1,
  };

  it('distingue cuotas por minuto y por hora para cada dimensión', () => {
    expect(commentRateLimitRetryAfterSeconds(below)).toBeNull();
    expect(commentRateLimitRetryAfterSeconds({ ...below, sessionMinute: publicCommentRatePolicy.sessionMinute })).toBe(60);
    expect(commentRateLimitRetryAfterSeconds({ ...below, ipMinute: publicCommentRatePolicy.ipMinute })).toBe(60);
    expect(commentRateLimitRetryAfterSeconds({ ...below, sessionHour: publicCommentRatePolicy.sessionHour })).toBe(3600);
    expect(commentRateLimitRetryAfterSeconds({ ...below, ipHour: publicCommentRatePolicy.ipHour })).toBe(3600);
    expect(commentRateLimitRetryAfterSeconds({ ...below, shareHour: publicCommentRatePolicy.shareHour })).toBe(3600);
  });

  it('cuenta puntos de código Unicode de acuerdo con maxLength del contrato', () => {
    const service = new PublicCommentsService({} as never);
    expect((service as any).validContent('😀'.repeat(2501))).toBe('😀'.repeat(2501));
    expect(() => (service as any).validContent('😀'.repeat(5001))).toThrow();
  });
});
