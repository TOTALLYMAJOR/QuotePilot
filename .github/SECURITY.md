# Security Policy

## Supported Branch
- `main`

## Reporting a Vulnerability
- Do not open public issues for security problems.
- Open a private report using GitHub Security Advisories:
  `https://github.com/TOTALLYMAJOR/Firebase-quote-wizard/security/advisories/new`
- Include reproduction steps, affected files/endpoints, and potential impact.

## Secret Handling Rules
- Never commit real secrets, API keys, access tokens, or private keys.
- Use `.env` for local values and keep `.env.example` placeholder-only.
- Rotate credentials immediately if a leak is suspected.

## Response Targets
- Initial triage target: within 2 business days.
- Containment/mitigation plan target: within 5 business days for confirmed high/critical issues.
