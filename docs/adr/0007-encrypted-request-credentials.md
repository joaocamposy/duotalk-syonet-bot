# ADR 0007: Encrypted request credentials

## Status

Accepted.

## Context

Another system manages the Syonet credentials and consumes this project as a microservice. This service cannot query that credential manager. The caller therefore needs to provide the Syonet URL, username, and password with each lead while the asynchronous file queue must not persist those values in plaintext.

## Decision

Use two separate security contexts:

- `Authorization: Bearer` authenticates the system consuming this microservice;
- the request body contains a dedicated `credentials` object with the Syonet login.
- every runtime requires `SYONET_ALLOWED_HOSTS` to constrain which network destinations those per-request URLs may target.

Require HTTPS and an exact DNS hostname present in the allowlist for the Syonet URL. Reject empty lists, wildcards, IPs, ports and embedded credentials. Repeat this validation at the controller, gateway and login boundaries. Encrypt the validated credential object with AES-256-GCM before enqueueing. Persist only the authenticated encrypted envelope and decrypt it in memory inside the worker. Never include the plaintext or encrypted envelope in logs or public job responses.

The deployment supplies `MICROSERVICE_API_TOKEN` and a 32-byte Base64 `CREDENTIAL_ENCRYPTION_KEY`. Rotating the encryption key requires draining the queue first because pending envelopes depend on the key used to create them.

## Consequences

The calling system remains the only credential manager. This service stores no reusable plaintext Syonet credential, but it must protect its API token and encryption key. Compromise of the running process can expose credentials currently being processed, while theft of the queue file alone does not reveal the Syonet login. Each new tenant hostname requires an explicit deployment change.
