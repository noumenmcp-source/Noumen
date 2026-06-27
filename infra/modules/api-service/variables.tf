variable "name_prefix" {
  type = string
}

variable "api_image" {
  type = string
}

variable "api_port" {
  type = number
}

variable "desired_count" {
  type = number
}

variable "public_subnet_ids" {
  type = list(string)
}

variable "api_security_group_id" {
  type = string
}

variable "secret_arn" {
  type = string
}

variable "rate_limit_max" {
  type = number
}

variable "rate_limit_window" {
  type = number
}
