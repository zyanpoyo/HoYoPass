# HoYoPass Agent Guide

## Context Pointers

Read the linked reference before changing the corresponding area:

- API endpoints, auth flow, alarms, or storage keys → [docs/design/architecture.md](docs/design/architecture.md)
- GA4 events or custom dimensions → [docs/design/ga4_analytics_spec.md](docs/design/ga4_analytics_spec.md)
- CI/CD workflows or adding any npm dependency (No-Dependency Policy applies) → [docs/design/ci_cd_security_architecture.md](docs/design/ci_cd_security_architecture.md)
- Structural refactoring candidates → [docs/reports/architecture-review-20261124-211215.html](docs/reports/architecture-review-20261124-211215.html)
- Store listing, permissions justification, or release version history (`Ready` / `Released`) → [CHROMEWEBSTORE.md](CHROMEWEBSTORE.md)

## Hidden Invariants

- **Default branch**: `master` (not `main`).
- **Dual-domain asymmetry**: Daily check-in and Takumi role APIs fall back across `.hoyolab.com` and `.hoyoverse.com`; code redemption (`webExchangeCdkey`) works on `.hoyoverse.com` only.
- **Zero private API calls on empty queue**: When unclaimed codes are 0 (`NO_PENDING_CODES`), skip all private HoYoverse/HoYoLAB API calls for both manual and scheduled runs.
- **Consistency guards**: Keep app version, privacy policy version, and `i18n.js` `ja`/`en` keys synchronized; `npm test` enforces them via `test/consistency.test.js` and `test/policy-version.test.js`.
- **Windows shell hygiene**: Prefer `git ls-files` over recursive directory walks (avoids `.entire/` and `dist/`). In Windows PowerShell 5.1, use `-Depth` (not `-MaxDepth`), and pipe UTF-8 text via `-F -` / `--body-file -` for Japanese commits and PRs.
