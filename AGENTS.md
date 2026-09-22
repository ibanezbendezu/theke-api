<!-- bmad:context -->
<!-- Verified 2026-09-22 against cd7d1a7cdeaf7b70cac005e5581918ed5bbf4bcf. Managed by bmad-project-context; edits inside this block are replaced on refresh. Keep anything you want preserved outside the markers. -->

## Theke API

Backend independiente de Theke sobre Node.js 24, NestJS/Fastify y PostgreSQL/Drizzle. Clerk autentica identidades y PostgreSQL conserva cuentas, membresías y autorización. La planificación BMAD canónica permanece en el repositorio hermano `theke`, dentro de `_bmad-output/`; no la dupliques aquí.

## Policy

- Nunca confíes en un `accountId` aportado por el cliente; deriva identidad y Cuenta desde el token Clerk validado y el contexto interno.
- Nunca registres tokens, cookies, correos ni contenido privado; conserva la redacción configurada y propaga el mismo `request.id` en `x-request-id` y `error.requestId`.
- Nunca confirmes `.env`, secretos Clerk, credenciales PostgreSQL ni tokens de publicación.
- Conserva `rawBody: true`: el webhook de Clerk necesita los bytes originales para verificar su firma.
- Mantén `ensureLocalUser` transaccional e idempotente y reutilízalo desde el primer request autenticado y el webhook.

## Where things are

- Bootstrap HTTP, CORS, logging y `requestId`: `src/main.ts`
- Composición Nest: `src/app.module.ts`
- Autenticación Clerk y `AuthContext`: `src/infrastructure/auth/`
- Esquema Drizzle y conexión PostgreSQL: `src/infrastructure/database/`
- Aprovisionamiento de cuenta: `src/modules/account/`
- Controladores y envelope HTTP: `src/interfaces/http/`
- Migraciones SQL versionadas: `drizzle/`
- Contrato OpenAPI publicable: `packages/contracts/openapi.json`
- Arquitectura y requisitos canónicos: repositorio hermano `theke`, `_bmad-output/planning-artifacts/`

## Running and verifying

- Usa Node.js 24; no aceptes resultados obtenidos únicamente con Node 22.
- En PowerShell de este workspace usa `npm.cmd`, porque la política local bloquea `npm.ps1`.
- Antes de entregar ejecuta lint, build, pruebas, `contracts:check` y la selección `test:e2e`; ningún comando sustituye los demás.
- No declares integración real con Clerk o PostgreSQL basándote en la suite actual: `tests/e2e/` todavía usa dobles y no levanta servicios externos.

## Conventions that differ from defaults

- Conserva extensiones `.js` en imports TypeScript internos; el proyecto usa ESM con `NodeNext`.
- Toda API versionada vive bajo `/v1`; éxito usa `{data,meta?}` y error `{error:{code,message,details?,requestId}}`.
- Mantén sincronizados `src/infrastructure/database/schema.ts` y las migraciones de `drizzle/`.
- Después de cambiar `packages/contracts/openapi.json`, regenera el manifest, ejecuta `contracts:check` y actualiza el cliente Orval del frontend.
- No edites manualmente `contract-manifest.json`; se deriva del OpenAPI.

## Known pitfalls

- `AccountService` todavía depende directamente de `Database`; no copies este acoplamiento en módulos nuevos. Introduce puertos de aplicación para nueva persistencia y refactoriza esta ruta antes de ampliar Account.
- No existe aún un migration job de Railway con advisory lock; no uses schema push ni describas el despliegue como completamente automatizado.
- La versión contractual aparece en varios archivos; al cambiarla coordina OpenAPI, paquete, manifest y verificadores.

<!-- /bmad:context -->
