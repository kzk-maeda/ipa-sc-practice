locals {
  worker_name = "ipa-sc-practice-${terraform.workspace}"
  issuer      = "https://${var.access_team_name}.cloudflareaccess.com"
}

resource "cloudflare_d1_database" "study" {
  account_id = var.account_id
  name       = local.worker_name

  lifecycle {
    prevent_destroy = true

    precondition {
      condition     = contains(["staging", "production"], terraform.workspace)
      error_message = "Select the staging or production Terraform workspace before planning resources."
    }
  }
}

resource "cloudflare_r2_bucket" "corpus" {
  count      = var.enable_r2 ? 1 : 0
  account_id = var.account_id
  name       = "${local.worker_name}-corpus"

  lifecycle {
    prevent_destroy = true
  }
}

resource "cloudflare_r2_managed_domain" "corpus" {
  count       = var.enable_r2 ? 1 : 0
  account_id  = var.account_id
  bucket_name = cloudflare_r2_bucket.corpus[count.index].name
  enabled     = false
}

resource "cloudflare_zero_trust_access_policy" "learners" {
  account_id = var.account_id
  name       = "${local.worker_name}-learners"
  decision   = "allow"
  include    = [for email in var.allowed_emails : { email = { email = email } }]
}

resource "cloudflare_zero_trust_access_application" "study" {
  account_id                 = var.account_id
  name                       = local.worker_name
  type                       = "self_hosted"
  domain                     = var.hostname
  destinations               = [{ type = "public", uri = var.hostname }]
  session_duration           = "24h"
  http_only_cookie_attribute = true

  policies = [{
    id         = cloudflare_zero_trust_access_policy.learners.id
    precedence = 1
  }]
}
