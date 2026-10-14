# CGM Node Backend

NestJS/TypeScript replacement for the legacy ASP.NET CGM API. The migration preserves the existing `api/*` HTTP contract and existing MySQL database rather than creating an incompatible application.

## Requirements

- Node.js 22 or newer
- MySQL 8
- A local `.env` file (already created on this development machine)

## Run

```powershell
Set-Location 'D:\Code\CGM\New app with node backend\Node backend'
npm.cmd install
npm.cmd run start:dev
```

The port comes from `API_PORT` in `.env`. Swagger is available at `/swagger`.

Google sign-in also requires `GOOGLE_CLIENT_ID` in `.env`. Password-reset email and alert email require the `SMTP_*` values. With no SMTP configuration, reset requests remain intentionally non-disclosing and the OTP is returned only when `NODE_ENV=development`.

## Implemented compatibility surface

All 17 legacy controllers and all 63 legacy HTTP action declarations have a Node route. This includes accounts/authentication, profiles, devices, sensors, glucose synchronization, alerts and rules, families, reports, notification endpoints, app versions, articles, dictionaries, hardware logs, admin, health and metrics. The service also includes the `/hubs/glucose` Socket.IO namespace, abnormal-reading alert creation, delivery retries, operational queue monitoring, and nightly daily-summary aggregation.

The existing MySQL schema remains authoritative. Automatic schema synchronization is disabled.

## Validate

```powershell
npm.cmd run typecheck
npm.cmd run build
npm.cmd test
```

## Migration rule

Do not delete or deploy over the old ASP.NET backend until every endpoint in the compatibility inventory has matching contract and integration tests. TypeORM schema synchronization is deliberately disabled so the Node application cannot modify the production schema implicitly.
