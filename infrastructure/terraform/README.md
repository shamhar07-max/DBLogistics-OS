# Terraform (reference AWS deployment) — DRAFT, NOT VALIDATED

Written to the blueprint but **never `terraform validate`d or applied** (no Terraform binary or cloud account in the build environment). Treat as a reviewed starting point. Choose the region only after reviewing customer data-residency, service availability, provider contracts and recovery arrangements (default below is a placeholder).

Layout: private network → RDS PostgreSQL 16 (Multi-AZ, PITR, KMS, no public access) → ElastiCache Redis (private) → S3 document bucket (private, versioned, KMS) → Secrets Manager → ECS Fargate services (`api`, `worker`, `staff-web`, `partner-portal`) behind an ALB + WAF. Task roles are least-privilege and separate per service. Migrations run as a one-off task with the migrator credential — **never** at API start.
