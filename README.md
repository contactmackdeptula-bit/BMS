# Fabric (working name)

Records and planning for the people who look after church buildings. The product name is configuration (`PRODUCT_NAME` in `wrangler.jsonc`), not a literal.

- `SPEC.md`: stack, data model, tenancy, security, milestones
- `docs/UI-HANDOFF.md`: screens, components, design tokens, states, AI touchpoints

## Run it locally

Copy `.dev.vars.example` to `.dev.vars` first (local settings: app address and email mode).

```bash
npm install
npm run db:migrate:local
npm run seed:local
npm run build
npm run dev:api
```

Open http://localhost:8787 and sign in as `admin@example.org`, `warden@example.org` or `estates@example.org` with the password `fabric local password` (local seed only). Emails are printed in the terminal instead of being sent, so invite and reset links appear there.

For front-end work with hot reload, run `npm run dev:api` and `npm run dev` together and open http://localhost:5173.

The component gallery is at `/components`.

## Checks

```bash
npm run typecheck
npm test
```

`npm test` first runs `scripts/check-tenancy.mjs`, which fails if a route file reads church data without going through `src/worker/tenancy.ts`.

## Layout

| Path | What |
|---|---|
| `src/worker/` | Cloudflare Worker: Hono API, auth, tenancy, repositories |
| `src/worker/db/schema.ts` | Drizzle schema (SPEC.md §5); `npm run db:generate` makes migrations |
| `src/web/` | React front end; `ui/` holds the shared components |
| `test/` | Vitest in the Workers runtime against a real local D1 |
| `migrations/` | D1 migrations |

## Production

- Cloudflare Worker `fabric`, served at https://fabric.mds-chms.workers.dev
- D1 database `fabric` (EU jurisdiction), R2 bucket `fabric-files`
- Deploy: `npm run build && npx wrangler d1 migrations apply fabric --remote && npx wrangler deploy`
- First admin for a parish: `node scripts/bootstrap.mjs --remote --parish "..." --email ...` prints a one-time invite link
- Until `EMAIL_MODE` is `brevo` (with `EMAIL_API_KEY` and `EMAIL_FROM` set as Worker secrets), no emails are sent: a PCC admin sees each invite link on screen to pass on, and password reset emails can't be delivered
