# 3. Pluggable Queue Drivers (Memory, File, Redis)

Date: 2026-08-11

## Status

Superseded by ADR 0008.

## Context

Browser automation via Playwright takes several seconds per lead. Direct synchronous execution would block webhook responses or crash if Redis is unavailable in v1.

## Decision

Create an abstract `QueueDriver` interface supporting `memory` and `file` drivers (persisting to `data/queue.json` across crashes) with extensibility for `redis`.

## Consequences

- Allows immediate `202 Accepted` webhook responses.
- Ensures zero job loss across server restarts even without Redis.
