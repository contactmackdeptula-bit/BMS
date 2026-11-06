# Fabric (working name)

Records and planning for the people who look after church buildings. The product name is configuration (`PRODUCT_NAME` in `wrangler.jsonc`), not a literal.

- `SPEC.md`: stack, data model, tenancy, security, milestones
- `docs/UI-HANDOFF.md`: screens, components, design tokens, states, AI touchpoints

## Run it locally

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
