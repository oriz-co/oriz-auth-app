# oriz-auth-app

Central sign-in surface for the [oriz.in](https://oriz.in) family — `auth.oriz.in`.

- Astro 6 static, Firebase Auth client SDK
- Cookie at `.oriz.in` syncs the ID token across every subdomain
- Providers: Google, GitHub, Microsoft, Email link (passwordless), Phone OTP (Pro+ gated)
- Deploys to Cloudflare Pages (project `oriz-auth-app`)

> Durable rules + design decisions live in [`../../knowledge/`](../../knowledge/) in the master repo. This README is intentionally short — see [`AGENTS.md`](../../AGENTS.md) for the full family convention.

## Local dev

```bash
pnpm install
pnpm dev          # http://localhost:4321
pnpm build        # static output -> dist/
pnpm deploy:pages # wrangler pages deploy
```

Env vars come from the master `.env` at the repo root (synced via `env-sync`). Required keys: `PUBLIC_FIREBASE_*` (six values) and optionally `PUBLIC_RECAPTCHA_SITE_KEY` for phone OTP.

## Routes

| Path | Purpose |
|---|---|
| `/` | Redirect to `/sign-in` or `/account` based on auth state |
| `/sign-in?return=<url>` | Provider buttons + email-link form; phone-OTP gated behind "More" |
| `/finish-sign-in` | Email-link callback handler |
| `/forgot-password` | Info page — oriz is passwordless |
| `/verify-email` | Send verification email to current user |
| `/account` | Signed-in user info + sign-out |
| `/sign-out` | Clears Firebase + cookie, redirects to `/sign-in` |

## License

MIT
