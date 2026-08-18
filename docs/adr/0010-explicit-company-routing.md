# ADR 0010: Explicit Syonet company routing

## Status

Accepted.

## Context

The Duotalk reference payload contains lead and conversation data but no Syonet company identifier. A Syonet origin can serve multiple stores, and credentials can open a session whose active company differs from the intended destination. Selecting the company implicitly could create an opportunity in the wrong store. The available validated endpoint reports the active session company but does not prove that the user can switch to every other company.

## Decision

Keep the Duotalk `data` object unchanged and require a service-level `target.companyId` supplied by the credential-management consumer. Immediately after authentication, compare it with `/api/sessao/empresa`. If they differ, stop before any customer lookup or write and mark the job non-retryable with `SYONET_COMPANY_ACCESS_DENIED`.

Include `companyId` in the tenant deduplication scope and in successful results. A synchronous mismatch returns `422`; asynchronous consumers receive the stable error code through job details. Pending legacy jobs without a target are failed safely and must be resubmitted after the destination is confirmed.

## Consequences

The integration cannot silently write to the active but unintended store. The consumer must associate each credential selection with the expected Syonet company. Supporting one login that actively switches among several companies requires a separately discovered and validated Syonet operation; arbitrary company switching is not inferred from the current endpoint.
