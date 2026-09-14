# Structural questions and shared capabilities — checkpoint 13

The scanner now attaches an optional version-1 structural question descriptor to field evidence: snapshot-local question, member, page, form and tree-scope identities; single-control/single-choice kind; member count and completeness. It carries no candidate answer. Radio options remain members of one logical question rather than separate progress rows.

Membership is bounded at 100 IDs. Larger groups retain their total count and are marked incomplete, not silently certified. The planner rejects incomplete groups and mismatched question/page/form/kind bindings with QUESTION_CONTRACT_INVALID. Unknown schema versions reject. Existing descriptors without this optional field remain accepted for migration compatibility; they do not gain the new membership proof.

`capabilitiesForControl` in contracts is shared by the planner and live browser. Supported native, ARIA, searchable and contenteditable controls use the same vocabulary. Password, hidden, range, time, week, datetime-local and submission controls do not become generic writable text. Unsupported controls require attention rather than a guessed write strategy.

Deploy API before the rebuilt extension, then reload application tabs. An older strict API may reject newly enriched descriptors; mixed-version deployment is not certified. These changes do not mutate candidate truth or bypass ownership, graph freshness, declaration or submit guards.

This is a transitional structural contract, not the complete architecture: member IDs are snapshot-local; durable binding, complete semantic/origin/commitment receipts, arbitrary multiselect groups, closed-shadow access and cross-origin frame execution remain unimplemented or unproven. No universal custom-form support is claimed.
