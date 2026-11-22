variable "account_id" {
  description = "Cloudflare account ID for this environment."
  type        = string
  nullable    = false

  validation {
    condition     = can(regex("^[a-f0-9]{32}$", var.account_id))
    error_message = "account_id must be a 32-character hexadecimal Cloudflare account ID."
  }
}

variable "hostname" {
  description = "Dedicated Worker custom hostname in an existing Cloudflare zone."
  type        = string
  nullable    = false

  validation {
    condition = (
      length(var.hostname) <= 253 &&
      can(regex("^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z][a-z0-9-]*[a-z0-9]$", var.hostname)) &&
      !endswith(var.hostname, ".workers.dev") &&
      !endswith(var.hostname, ".cloudflareaccess.com")
    )
    error_message = "hostname must be a lowercase custom hostname without a URL scheme, path, or wildcard."
  }
}

variable "access_team_name" {
  description = "Team name of the existing Cloudflare Zero Trust organization."
  type        = string
  nullable    = false

  validation {
    condition     = can(regex("^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$", var.access_team_name))
    error_message = "access_team_name must be the lowercase subdomain label before .cloudflareaccess.com."
  }
}

variable "allowed_emails" {
  description = "Exact email addresses allowed by the Access application."
  type        = set(string)
  nullable    = false
  sensitive   = true

  validation {
    condition = nonsensitive(
      length(var.allowed_emails) > 0 &&
      alltrue([for email in var.allowed_emails : can(regex("^[^@*[:space:]]+@[^@*[:space:]]+\\.[^@*[:space:]]+$", email))])
    )
    error_message = "allowed_emails must contain at least one explicit email address."
  }
}

variable "enable_r2" {
  description = "Provision a private R2 corpus bucket and expose the CORPUS Worker binding."
  type        = bool
  default     = false
  nullable    = false
}

variable "ai" {
  description = "Responses API settings. Leave null to disable AI. Set the API key separately as a Worker secret."
  type = object({
    model                  = string
    input_usd_per_million  = number
    output_usd_per_million = number
    daily_limit            = optional(number, 20)
    monthly_budget_usd     = optional(number, 5)
  })
  default = null

  validation {
    condition = var.ai == null ? true : (
      length(trimspace(var.ai.model)) > 0 &&
      var.ai.daily_limit >= 1 && floor(var.ai.daily_limit) == var.ai.daily_limit &&
      var.ai.input_usd_per_million > 0 && var.ai.output_usd_per_million > 0 &&
      var.ai.monthly_budget_usd >= 0.000001
    )
    error_message = "AI settings require a model, positive prices and budget, and a positive whole-number daily limit."
  }
}
