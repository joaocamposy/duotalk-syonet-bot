# ADR 0011: Fail-closed Syonet mappings

## Status

Accepted.

## Context

The Duotalk reference payload exposes business descriptions such as channel, origin, qualification, intermediary and intent. Syonet accepts tenant-specific contact forms, event types and media. Guessing the first available option or scattering provisional aliases through the HTTP client could route an opportunity incorrectly and make the functional validation difficult to audit.

Conversation history may also contain file URLs with access tokens. Keeping unused reference fields or sensitive query parameters in the durable queue would create unnecessary exposure.

## Decision

Centralize provisional business mappings in `src/config/syonet-mappings.ts` and keep selection logic in a pure module. Resolve every required Syonet option before the first write. If no confirmed option exists, stop without retry and expose a stable mapping error code; synchronous requests return `422`.

Make `dryRun` execute the same read and mapping phase as a real job, returning the selected mapping while suppressing every `POST`. Give dry-run and write jobs separate deduplication scopes. This allows tenant-specific validation followed by a real submission with the same conversation identifier.

Let Zod discard reference fields that have no active use. Redact known sensitive URL parameters in text fields before enqueueing and again while building the Syonet observation.

## Consequences

Monday's functional validation changes one mapping table rather than the integration flow. Unknown tenant values cannot silently fall back to an arbitrary CRM option. Consumers can inspect a complete mapping through `dryRun` without writing. Mapping failures may be resubmitted with the same identifier after correction. New sensitive parameter names must be added to the sanitizer when discovered.
