const requiredEnvironmentKeys = [
  'DATABASE_URL',
  'CLERK_SECRET_KEY',
  'CLERK_PUBLISHABLE_KEY',
  'CLERK_JWT_KEY',
  'CLERK_AUTHORIZED_PARTIES',
  'CLERK_WEBHOOK_SIGNING_SECRET',
  'WEB_ORIGINS',
] as const;

export function requireEnvironment(name: typeof requiredEnvironmentKeys[number]): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Falta configurar ${name}`);
  return value;
}

export function parseEnvironmentList(name: 'CLERK_AUTHORIZED_PARTIES' | 'WEB_ORIGINS'): string[] {
  const values = requireEnvironment(name).split(',').map((value) => value.trim()).filter(Boolean);
  if (values.length === 0) throw new Error(`Falta configurar ${name}`);
  return values;
}

export function validateEnvironment(): void {
  for (const key of requiredEnvironmentKeys) requireEnvironment(key);
  parseEnvironmentList('CLERK_AUTHORIZED_PARTIES');
  parseEnvironmentList('WEB_ORIGINS');
}
