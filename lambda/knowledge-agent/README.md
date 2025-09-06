# Knowledge Agent Lambda

Provides region-aware audit/compliance guidance sourced from the knowledge-base S3 bucket.

- Detects Australia/NDIS from the user message and loads `regional-healthcare/australia/ndis-guidelines.md`.
- Extracts key sections (Audit Requirements, Code of Conduct, Contacts) and returns a normalized checklist.
- Exposed to the Agent Router as `enabl-knowledge-agent-<env>`.

Environment variables:
- AWS_REGION
- ENVIRONMENT
- KNOWLEDGE_BUCKET