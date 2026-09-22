# Theke API

API independiente de Theke sobre Node.js 24, NestJS/Fastify, PostgreSQL y Drizzle.

## Desarrollo

1. Copia `.env.example` a `.env` y configura PostgreSQL y Clerk.
2. En desarrollo, aplica `drizzle/0001_account_identity.sql` sobre una base local. El job de migración de Railway con advisory lock sigue pendiente antes del piloto; no uses schema push en producción.
3. Ejecuta `npm install`, `npm run build` y `npm start`.

`GET /health` es público. `GET /v1/me` valida un Bearer session token, deriva la cuenta desde la identidad y aprovisiona `User`, `Account` y `Membership` en una transacción idempotente. El webhook verificado reutiliza el mismo caso de uso. Los logs redactan credenciales y los errores propagan `requestId`.

El contrato canónico está en `packages/contracts/openapi.json`, preparado para publicación inmutable como `@theke/contracts`. Verifica con `npm run lint`, `npm run build`, `npm test`, `npm run contracts:check` y `npm run test:e2e -- auth`.
