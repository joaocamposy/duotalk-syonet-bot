# ADR 0009: Structured logging to stdout

## Status

Accepted. Supersedes the file-log portion of ADR 0005.

## Context

The previous logger selected one dated filename at process startup, did not rotate at midnight, and required an application timer to delete files. Container platforms already provide log collection and retention, while local log files increased disk and personal-data exposure.

## Decision

Write structured Pino JSON to stdout. Redact authorization, passwords, credential objects, and encrypted envelopes by field path. Do not log lead names or phone numbers. Delegate collection, access control, rotation, and retention to the deployment platform.

## Consequences

The application no longer creates or purges log files and does not need a logs volume. Operators must configure retention in the container or hosting platform. Local development can pipe stdout to a formatter when human-readable output is desired.
