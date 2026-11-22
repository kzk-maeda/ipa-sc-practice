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
    vars = {
      APP_ENV          = "cloudflare"
      APP_HOSTNAME     = var.hostname
      CF_ACCESS_ISSUER = local.issuer
      CF_ACCESS_AUD    = cloudflare_zero_trust_access_application.study.aud
    }
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
