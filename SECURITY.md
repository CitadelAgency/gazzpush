# Security policy

Gazzpush holds unpublished reporting: drafts, source documents, interview recordings and the identities of people
contacted for comment. We treat vulnerabilities that could expose that material as the highest priority.

## Reporting a vulnerability

**Do not open a public issue.** Report privately through GitHub:

1. Go to the repository's [Security tab](https://github.com/CitadelAgency/gazzpush/security).
2. Click **Report a vulnerability**.
3. Describe the issue, the affected version or commit, steps to reproduce and the impact you observed.

We will acknowledge your report, keep you updated while we work on a fix, and agree on a disclosure timeline with
you. Please give us a reasonable chance to release a fix before disclosing publicly.

## Scope

Especially relevant:

- Cross-tenant access: reading or changing another outlet's stories, dossiers, files or settings.
- Authentication or session bypass, CSRF, and privilege escalation between `reporter`, `editor` and `admin`.
- Exposure of stored files (`/media/*`, documents, recordings, defense packages) without authorization.
- Leakage of encrypted credentials or of `TOKEN_ENC_KEY`-protected data.
- Server-side request forgery through URL fetching (sources, brand import, Wayback).
- Tampering with defense packages or timestamps that verification would not detect.

Out of scope: vulnerabilities in a self-hosted deployment caused by its own misconfiguration (for example, a leaked
`.dev.vars`), and issues in third-party services such as Cloudflare, model providers or Instagram, which should be
reported to them.

## Supported versions

Gazzpush has not reached 1.0. Security fixes are made on `main`; self-hosted installs should stay up to date with it.

## Operator responsibilities

If you self-host, you are responsible for your secrets (`BETTER_AUTH_SECRET`, `TOKEN_ENC_KEY`, provider keys), for
restricting `ADMIN_USER_IDS`, and for reviewing the data policies of the model providers you configure: text sent for
checking leaves your Cloudflare account.
