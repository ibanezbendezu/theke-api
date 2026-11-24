// Versioned in Git so pilot limit changes remain reviewable and auditable.
export const publicCommentRatePolicy = Object.freeze({
  version: '2026-09-pilot-1',
  sessionMinute: 5,
  sessionHour: 30,
  ipMinute: 20,
  ipHour: 100,
  shareHour: 100,
});

export type PublicCommentRateCounts = {
  sessionMinute: number;
  sessionHour: number;
  ipMinute: number;
  ipHour: number;
  shareHour: number;
};

export function commentRateLimitRetryAfterSeconds(counts: PublicCommentRateCounts) {
  const hourlyLimitReached = counts.sessionHour >= publicCommentRatePolicy.sessionHour
    || counts.ipHour >= publicCommentRatePolicy.ipHour
    || counts.shareHour >= publicCommentRatePolicy.shareHour;
  if (hourlyLimitReached) return 3600;
  return counts.sessionMinute >= publicCommentRatePolicy.sessionMinute
    || counts.ipMinute >= publicCommentRatePolicy.ipMinute ? 60 : null;
}
