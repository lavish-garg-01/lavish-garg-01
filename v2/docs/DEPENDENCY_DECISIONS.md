# V2 dependency decisions

Every dependency must solve a named requirement and remain replaceable at a domain boundary.

| Dependency | Requirement | Why the platform alone is insufficient | Runtime / bundle effect | Security and maintenance decision |
| --- | --- | --- | --- | --- |
| Fastify | Typed, observable HTTP API with predictable lifecycle hooks | Node's HTTP module would require rebuilding routing, validation integration and error lifecycle | Backend only | Mature backend dependency; no browser bundle |
| Zod | Runtime validation for external and shared contracts | TypeScript types disappear at runtime | Backend, workers and build-time browser contract generation | Closed schemas; external values remain untrusted |
| Kysely + `pg` | Portable, typed PostgreSQL queries behind repository ports | Raw SQL alone gives no typed query boundary; Supabase client would couple the domain to one provider | Backend/worker only | Parameterized queries; no service credentials in web/extension |
| Pino | Structured, redactable logs | Console output has no consistent schema or redaction controls | Backend/worker only | Candidate values are excluded/redacted by policy |
| Fastify Swagger plugins | Generate and expose an OpenAPI contract from route schemas | A handwritten API document drifts from runtime behavior | Backend development/runtime only | Documentation can be disabled or protected outside development |
| TypeScript | Strict contracts across new V2 package boundaries | V1's runtime/JSDoc approach is preserved only as a reference system | Build-time; emitted JavaScript at runtime | Strict settings and architecture checks are mandatory |
| ESLint + typescript-eslint | Static policy and correctness checks | TypeScript does not enforce all codebase rules | Development/CI only | Pinned and not shipped to product runtimes |
| `tsx` | Execute TypeScript tests and local development without a second bundler | Node does not execute TypeScript source directly | Development only | Not present in production runtime image |
| PGlite | Execute the PostgreSQL migration from an empty database in local/CI environments without Docker | SQLite/SQL parsing cannot prove PostgreSQL DDL executes; Docker is unavailable in some local agents | Test only | Never authoritative storage; production remains PostgreSQL |

Rejected for the initial build: Redis, Kafka, ClickHouse, OpenSearch/Elasticsearch, GraphQL, a vector database, Kubernetes, generic workflow engines, remote browser-code frameworks, and a microservice-per-package deployment.
