# 4. Playwright Automation & Session Management

Date: 2026-08-11

## Status

Superseded by ADR 0006.

## Context

Automating Syonet CRM requires robust wait strategies, authentication state re-use, and visual error diagnostics.

## Decision

Use **Playwright** with Chromium, session persistence via `storage_state.json`, auto-waiting selectors, and automatic screenshot capture on navigation errors.

## Consequences

- Eliminates repeated logins per webhook request.
- Captures `logs/screenshots/job-{jobId}-error.png` automatically whenever Playwright encounters a DOM error.
