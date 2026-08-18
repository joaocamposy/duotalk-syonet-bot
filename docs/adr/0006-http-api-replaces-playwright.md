# ADR 0006: HTTP API replaces Playwright automation

## Status

Accepted. Supersedes ADR 0004 for lead ingestion.

## Context

The previous REST experiment only ran in dry-run mode, used payload fields that did not match the official portal, and could report simulated success without writing data. Inspection of the portal and live proof-of-concept calls confirmed HTTP authentication, `POST /api/cliente`, and `POST /api/evento`.

## Decision

Use HTTP as the only lead-processing transport. Reproduce the RSA-OAEP login, search customers by phone, discover tenant metadata, create customer and event payloads with native fields, and validate returned IDs. Renew the session once after an authentication failure only for safe reads; never replay a `POST` automatically.

Playwright and its DOM automation modules are removed.

## Consequences

The integration is faster, deterministic, and testable without a browser. It depends on undocumented portal endpoints, so internal failures preserve the HTTP method, route, and status for diagnosis without copying response bodies or credentials into public errors.
