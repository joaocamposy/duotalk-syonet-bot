# 5. Resilience & Log Auto-Purge Strategy

Date: 2026-08-11

## Status

Superseded by ADRs 0006, 0008, and 0009.

## Context

Production servers can crash, restart, or run out of disk space if logs and screenshots accumulate infinitely.

## Decision

Implement exponential backoff retries (up to 3 attempts), graceful shutdown handlers (`SIGTERM`/`SIGINT`), and an automated log purger scheduled every 24 hours deleting logs/screenshots older than `LOG_RETENTION_DAYS`.

## Consequences

- Protects disk storage from filling up.
- Ensures graceful termination of Playwright browser instances without leaving orphaned Chromium processes.
