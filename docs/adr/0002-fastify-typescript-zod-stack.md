# 2. Fastify + TypeScript + Zod Stack

Date: 2026-08-11

## Status
Accepted

## Context
The project requires a fast, strongly-typed HTTP webhook receiver for incoming lead payloads from Duotalk and n8n.

## Decision
Adopt **Fastify**, **TypeScript**, and **Zod** as the core web framework.

## Consequences
- Fastify provides ultra-low latency and built-in Swagger/OpenAPI support.
- Zod guarantees runtime payload validation and type safety.
