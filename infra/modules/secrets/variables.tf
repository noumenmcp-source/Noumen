variable "name_prefix" {
  type = string
}

variable "database_url" {
  type      = string
  sensitive = true
}

variable "resend_api_key" {
  type      = string
  sensitive = true
}

variable "ai_gateway_base_url" {
  type = string
}

variable "ai_gateway_api_key" {
  type      = string
  sensitive = true
}
