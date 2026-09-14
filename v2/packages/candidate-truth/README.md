# Candidate Truth

This package owns semantic, scoped, versioned and reversible reusable candidate truth.

Phase E1 provides the reviewed ontology, normalized private-value contract, answer policy, exact scope precedence, freshness and anomaly decisions. Unknown canonicals fail closed. Application declarations and protected values do not become reusable candidate truth.

Phase E2 adds repository ports and transactional PostgreSQL write authority: append-only answer versions, a maintained current projection, keyed value fingerprints, exact idempotency, optimistic concurrency, stable entity ownership and value-free outbox events.

Phase E3 adds the bounded current-projection resolver, exact-scope REVIEW trials, verified REVIEW promotion/correction and redundant contextual override removal.

Phase E4 adds atomic 1–50 item grouped writes, immutable reversal history, partial-safe append-only Undo, explicit append-only Restore, newer-intent protection, tuple-cursor history pagination and value-free receipts/outbox events. A `REMOVED` projection remains invisible to resolution while still serving as the storage-level OCC head, so the candidate can safely answer that field again.

Runtime proposals and the user-facing “Updated for next time” review/Undo surface are intentionally owned by Phases M and G/M. They must use these E4 service contracts rather than create a second candidate-truth authority.

This package must never depend on the extension, API framework, V1 repositories or a concrete database client.
