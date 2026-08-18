# ADR 0008: Queue integrity and retry safety

## Status

Accepted. Supersedes ADR 0003.

## Context

The project advertised a Redis driver that silently used the file driver, wrote the complete queue non-atomically, retained personal data indefinitely, and retried every failure even when a Syonet write might already have been committed.

## Decision

Expose only the implemented `memory` and `file` drivers. Persist runtime file updates asynchronously and serially through a temporary file, fsync and atomic rename with mode `0600`. Refuse to start from a malformed queue instead of silently replacing it. Remove personal lead data and credentials as soon as a job becomes terminal, remove terminal metadata after `JOB_RETENTION_DAYS`, and bound retained jobs with `QUEUE_MAX_JOBS`, applying backpressure when no terminal job can be evicted safely.

Retry transient read/authentication failures with exponential delay, but do not retry rejected credentials. Renew the session once only for safe reads after `401`, `403` or a redirect. Never replay a Syonet `POST` automatically: authentication rejection, network failure, redirect or invalid response after a write all require conservative reconciliation. Recover jobs left in `processing` after a crash as ambiguous failures instead of replaying them. Scope deduplication by hashes of the Syonet tenant origin, company, execution mode and conversation, lead or phone identifier. Allow a new job after a correctable company or mapping failure; preserve the block for ambiguous failures.

## Consequences

The service avoids silent fallback, truncated queue replacement, indefinite personal-data retention, cross-tenant/dry-run deduplication collisions, and automatic duplicate writes. Pending file jobs still contain lead data and require encrypted storage. An ambiguous write can require operational review and manual retry after checking the CRM. The file driver remains suitable for a single process only; horizontal scaling requires a future external queue implementation with atomic deduplication.
