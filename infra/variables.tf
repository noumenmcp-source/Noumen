variable "aws_region" {
  description = "US AWS region for the CDP-US deployment."
  type        = string
  default     = "us-east-1"

  validation {
    condition     = startswith(var.aws_region, "us-")
    error_message = "CDP-US infrastructure must use a US AWS region."
  }
}

variable "environment" {
  description = "Deployment environment name."
  type        = string
  default     = "staging"
}

variable "api_image" {
  description = "Container image for apps/api."
  type        = string
}

variable "api_desired_count" {
  description = "Desired number of API tasks."
  type        = number
  default     = 1
}

variable "rate_limit_max" {
  description = "RATE_LIMIT_MAX for the API service."
  type        = number
  default     = 600
}

variable "rate_limit_window" {
  description = "RATE_LIMIT_WINDOW in seconds for the API service."
  type        = number
  default     = 60
}

variable "database_name" {
  description = "Managed Postgres database name."
  type        = string
  default     = "cdp_us"
}

variable "database_username" {
  description = "Managed Postgres username."
  type        = string
  default     = "cdp"
}

variable "database_password" {
  description = "Managed Postgres password. Pass via TF_VAR_database_password or a secure secrets workflow."
  type        = string
  sensitive   = true
}

variable "resend_api_key" {
  description = "Optional Resend API key."
  type        = string
  default     = ""
  sensitive   = true
}

variable "ai_gateway_base_url" {
  description = "Optional AI gateway base URL."
  type        = string
  default     = ""
}

variable "ai_gateway_api_key" {
  description = "Optional AI gateway API key."
  type        = string
  default     = ""
  sensitive   = true
}
