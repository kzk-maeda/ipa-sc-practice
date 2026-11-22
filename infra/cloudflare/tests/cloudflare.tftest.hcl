mock_provider "cloudflare" {
  override_during = plan

  mock_resource "cloudflare_d1_database" {
    defaults = { id = "36472f1f-ad04-498d-be14-ebd697c76121" }
  }

  mock_resource "cloudflare_zero_trust_access_policy" {
    defaults = { id = "4a116cf2-954d-4581-8028-9f182efe43a0" }
  }

  mock_resource "cloudflare_zero_trust_access_application" {
    defaults = { aud = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" }
  }
}

variables {
  account_id       = "0123456789abcdef0123456789abcdef"
  hostname         = "practice-test.example.com"
  access_team_name = "my-team"
  allowed_emails   = ["learner@example.com"]
}

run "bind_worker_to_the_environment" {
  command = plan

  assert {
    condition = (
      output.wrangler_config.name == "ipa-sc-practice-${terraform.workspace}" &&
      output.wrangler_config.d1_databases[0].database_name == output.wrangler_config.name &&
      output.wrangler_config.d1_databases[0].database_id == "36472f1f-ad04-498d-be14-ebd697c76121" &&
      length(output.wrangler_config.r2_buckets) == 0
    )
    error_message = "The Worker must be bound to its environment's D1 database."
  }

  assert {
    condition = (
      !output.wrangler_config.workers_dev &&
      !output.wrangler_config.preview_urls &&
      output.wrangler_config.routes[0].custom_domain &&
      !output.wrangler_config.routes[0].previews_enabled &&
      output.wrangler_config.routes[0].pattern == var.hostname &&
      cloudflare_zero_trust_access_application.study.destinations[0].uri == var.hostname &&
      cloudflare_zero_trust_access_application.study.policies[0].id == cloudflare_zero_trust_access_policy.learners.id &&
      cloudflare_zero_trust_access_policy.learners.decision == "allow" &&
      toset([for rule in cloudflare_zero_trust_access_policy.learners.include : rule.email.email]) == var.allowed_emails &&
      output.wrangler_config.vars.APP_ENV == "cloudflare" &&
      output.wrangler_config.vars.APP_HOSTNAME == var.hostname &&
      output.wrangler_config.vars.CF_ACCESS_ISSUER == "https://my-team.cloudflareaccess.com" &&
      output.wrangler_config.vars.CF_ACCESS_AUD == cloudflare_zero_trust_access_application.study.aud
    )
    error_message = "Only the Access-protected custom hostname should be routable."
  }
}

run "optionally_bind_private_r2" {
  command = plan

  variables {
    enable_r2 = true
  }

  assert {
    condition = (
      cloudflare_r2_bucket.corpus[0].name == "ipa-sc-practice-${terraform.workspace}-corpus" &&
      !cloudflare_r2_managed_domain.corpus[0].enabled &&
      output.wrangler_config.r2_buckets[0].binding == "CORPUS" &&
      output.wrangler_config.r2_buckets[0].bucket_name == cloudflare_r2_bucket.corpus[0].name
    )
    error_message = "The R2 binding must point to a non-public bucket in this environment."
  }
}

run "reject_empty_access_allowlist" {
  command = plan

  variables {
    allowed_emails = []
  }

  expect_failures = [var.allowed_emails]
}
