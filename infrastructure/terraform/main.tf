terraform {
  required_version = ">= 1.7"
  required_providers { aws = { source = "hashicorp/aws", version = "~> 5.80" } }
}
variable "env"        { type = string }                       # staging | production
variable "region"     { type = string, default = "me-central-1" } # placeholder — decide per data-residency review
variable "image_tag"  { type = string }
variable "domain"     { type = string }
variable "vpc_cidr"   { type = string, default = "10.40.0.0/16" }
provider "aws" { region = var.region }
locals { name = "dbl-${var.env}" }

# ---------- network ----------
data "aws_availability_zones" "az" { state = "available" }
resource "aws_vpc" "main" { cidr_block = var.vpc_cidr, enable_dns_hostnames = true, tags = { Name = local.name } }
resource "aws_subnet" "private" { count = 2, vpc_id = aws_vpc.main.id, cidr_block = cidrsubnet(var.vpc_cidr, 4, count.index), availability_zone = data.aws_availability_zones.az.names[count.index] }
resource "aws_subnet" "public"  { count = 2, vpc_id = aws_vpc.main.id, cidr_block = cidrsubnet(var.vpc_cidr, 4, count.index + 8), availability_zone = data.aws_availability_zones.az.names[count.index], map_public_ip_on_launch = true }

# ---------- keys & secrets ----------
resource "aws_kms_key" "data" { description = "${local.name} data", enable_key_rotation = true, deletion_window_in_days = 30 }
resource "aws_secretsmanager_secret" "db_app"      { name = "${local.name}/db/app",      kms_key_id = aws_kms_key.data.arn }
resource "aws_secretsmanager_secret" "db_worker"   { name = "${local.name}/db/worker",   kms_key_id = aws_kms_key.data.arn }
resource "aws_secretsmanager_secret" "db_migrator" { name = "${local.name}/db/migrator", kms_key_id = aws_kms_key.data.arn }
resource "aws_secretsmanager_secret" "session"     { name = "${local.name}/web/session-secret", kms_key_id = aws_kms_key.data.arn }
resource "aws_secretsmanager_secret" "oidc_client" { name = "${local.name}/web/oidc-client", kms_key_id = aws_kms_key.data.arn }

# ---------- PostgreSQL: Multi-AZ, encrypted, PITR (backup retention), private ----------
resource "aws_db_subnet_group" "db" { name = local.name, subnet_ids = aws_subnet.private[*].id }
resource "aws_security_group" "db"  { vpc_id = aws_vpc.main.id, ingress { from_port = 5432, to_port = 5432, protocol = "tcp", security_groups = [aws_security_group.app.id] } }
resource "aws_security_group" "app" { vpc_id = aws_vpc.main.id, egress { from_port = 0, to_port = 0, protocol = "-1", cidr_blocks = ["0.0.0.0/0"] } }
resource "aws_db_instance" "pg" {
  identifier = local.name, engine = "postgres", engine_version = "16", instance_class = var.env == "production" ? "db.m6g.large" : "db.t4g.medium"
  allocated_storage = 100, max_allocated_storage = 1000, storage_encrypted = true, kms_key_id = aws_kms_key.data.arn
  multi_az = var.env == "production", publicly_accessible = false, db_subnet_group_name = aws_db_subnet_group.db.name, vpc_security_group_ids = [aws_security_group.db.id]
  backup_retention_period = 14, deletion_protection = var.env == "production", performance_insights_enabled = true, username = "dbl_admin", manage_master_user_password = true
  skip_final_snapshot = var.env != "production", enabled_cloudwatch_logs_exports = ["postgresql"]
}

# ---------- Redis (queues only — not a system of record) ----------
resource "aws_elasticache_subnet_group" "r" { name = local.name, subnet_ids = aws_subnet.private[*].id }
resource "aws_elasticache_replication_group" "redis" {
  replication_group_id = local.name, description = "BullMQ", engine = "redis", node_type = "cache.t4g.small", num_cache_clusters = var.env == "production" ? 2 : 1
  at_rest_encryption_enabled = true, transit_encryption_enabled = true, subnet_group_name = aws_elasticache_subnet_group.r.name, security_group_ids = [aws_security_group.app.id], automatic_failover_enabled = var.env == "production"
}

# ---------- documents: private, versioned, KMS ----------
resource "aws_s3_bucket" "docs" { bucket = "${local.name}-documents" }
resource "aws_s3_bucket_public_access_block" "docs" { bucket = aws_s3_bucket.docs.id, block_public_acls = true, block_public_policy = true, ignore_public_acls = true, restrict_public_buckets = true }
resource "aws_s3_bucket_versioning" "docs" { bucket = aws_s3_bucket.docs.id, versioning_configuration { status = "Enabled" } }
resource "aws_s3_bucket_server_side_encryption_configuration" "docs" { bucket = aws_s3_bucket.docs.id, rule { apply_server_side_encryption_by_default { sse_algorithm = "aws:kms", kms_master_key_id = aws_kms_key.data.arn } } }

# ---------- compute ----------
resource "aws_ecs_cluster" "main" { name = local.name, setting { name = "containerInsights", value = "enabled" } }
resource "aws_iam_role" "task_api" {   # API: documents bucket + its own secrets only
  name = "${local.name}-task-api"
  assume_role_policy = jsonencode({ Version = "2012-10-17", Statement = [{ Effect = "Allow", Principal = { Service = "ecs-tasks.amazonaws.com" }, Action = "sts:AssumeRole" }] })
}
resource "aws_iam_role_policy" "task_api" {
  role = aws_iam_role.task_api.id
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Effect = "Allow", Action = ["s3:GetObject", "s3:PutObject", "s3:HeadObject"], Resource = "${aws_s3_bucket.docs.arn}/*" },
    { Effect = "Allow", Action = ["kms:Decrypt", "kms:GenerateDataKey"], Resource = aws_kms_key.data.arn },
    { Effect = "Allow", Action = "secretsmanager:GetSecretValue", Resource = [aws_secretsmanager_secret.db_app.arn] } ] })
}
# One ecs_service per deployable (api, worker, staff-web, partner-portal) — see modules/ecs-service (to be written);
# web, API and worker deploy independently from the same image tag. DB migrations: run-task with the migrator secret BEFORE service update (additive migrations only).

# ---------- edge ----------
resource "aws_wafv2_web_acl" "edge" {
  name = local.name, scope = "REGIONAL"
  default_action { allow {} }
  rule { name = "managed-common", priority = 1, override_action { none {} }
    statement { managed_rule_group_statement { name = "AWSManagedRulesCommonRuleSet", vendor_name = "AWS" } }
    visibility_config { cloudwatch_metrics_enabled = true, metric_name = "common", sampled_requests_enabled = true } }
  visibility_config { cloudwatch_metrics_enabled = true, metric_name = local.name, sampled_requests_enabled = true }
}
