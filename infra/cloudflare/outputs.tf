output "wrangler_config" {
  description = "Cloud bindings and the protected hostname for the root Wrangler configuration."
  value = {
    name         = local.worker_name
    account_id   = var.account_id
    workers_dev  = false
    preview_urls = false
    routes = [{
      pattern          = var.hostname
      custom_domain    = true
      previews_enabled = false
    }]
    triggers = { crons = ["0 18 * * *"] }
    vars = merge({
      APP_ENV          = "cloudflare"
      APP_HOSTNAME     = var.hostname
      CF_ACCESS_ISSUER = local.issuer
      CF_ACCESS_AUD    = cloudflare_zero_trust_access_application.study.aud
      }, var.ai == null ? {} : {
      AI_MODE                   = "openai"
      OPENAI_MODEL              = var.ai.model
      AI_DAILY_LIMIT            = tostring(var.ai.daily_limit)
      AI_MONTHLY_BUDGET_USD     = tostring(var.ai.monthly_budget_usd)
      AI_INPUT_USD_PER_MILLION  = tostring(var.ai.input_usd_per_million)
      AI_OUTPUT_USD_PER_MILLION = tostring(var.ai.output_usd_per_million)
    })
    d1_databases = [{
      binding       = "DB"
      database_name = cloudflare_d1_database.study.name
      database_id   = cloudflare_d1_database.study.id
    }]
    r2_buckets = [for bucket in cloudflare_r2_bucket.corpus : {
      binding     = "CORPUS"
      bucket_name = bucket.name
    }]
  }
}
