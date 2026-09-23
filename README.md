# Theke API

API independiente de Theke sobre Node.js 24, NestJS/Fastify, PostgreSQL y Drizzle.

## Desarrollo

1. Desde un checkout limpio, copia el template versionado `.env.example` a `.env`; crea un proyecto gratuito en Neon y configura su cadena pooled con TLS como `DATABASE_URL`.
2. Configura en ese `.env` las credenciales de Clerk para `http://localhost:5173`. Nunca confirmes el archivo ni claves reales en Git.
3. Abre Neon SQL Editor y ejecuta `drizzle/0001_account_identity.sql`. No uses schema push.
4. Ejecuta `npm install`, `npm run build` y `npm start`; ambos comandos de ejecución (`dev` y `start`) cargan `.env` mediante Node 24 y la API queda disponible en `http://localhost:3000`.

`GET /health` es público. `GET /v1/me` valida un Bearer session token, deriva la cuenta desde la identidad y aprovisiona `User`, `Account` y `Membership` en una transacción idempotente. El webhook verificado reutiliza el mismo caso de uso. Los logs redactan credenciales y los errores propagan `requestId`.

El contrato canónico está en `packages/contracts/openapi.json`, preparado para publicación inmutable como `@theke/contracts`. Verifica con `npm run lint`, `npm run build`, `npm test`, `npm run contracts:check` y `npm run test:e2e -- auth`.

## Smoke local Clerk + Neon

Con la migración aplicada y las credenciales reales solo en `.env`, inicia la API y después `theke-web`. Abre `http://localhost:5173`, completa OTP o Google y confirma que `GET /v1/me` responde 200 sin que el navegador envíe `accountId`. Recarga dos veces y comprueba en Neon que existe una sola fila para el usuario de Clerk, una sola cuenta personal y una sola membresía `owner`. Finalmente cierra sesión y comprueba que recargar o volver atrás no muestra el shell privado anterior.

Si `/v1/me` falla, usa el `requestId` visible en la respuesta para correlacionar el error; no copies tokens, correo ni credenciales en logs o reportes.
