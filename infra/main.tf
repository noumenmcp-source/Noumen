locals {
  name_prefix = "cdp-us-${var.environment}"
  api_port    = 8110
}

module "network" {
  source      = "./modules/network"
  name_prefix = local.name_prefix
}

module "database" {
  source              = "./modules/database"
  name_prefix         = local.name_prefix
  database_name       = var.database_name
  database_username   = var.database_username
  database_password   = var.database_password
  private_subnet_ids  = module.network.private_subnet_ids
  database_sg_id      = module.network.database_sg_id
}

module "secrets" {
  source              = "./modules/secrets"
  name_prefix         = local.name_prefix
  database_url        = module.database.database_url
  resend_api_key      = var.resend_api_key
  ai_gateway_base_url = var.ai_gateway_base_url
  ai_gateway_api_key  = var.ai_gateway_api_key
}

module "api_service" {
  source               = "./modules/api-service"
  name_prefix          = local.name_prefix
  api_image            = var.api_image
  api_port             = local.api_port
  desired_count        = var.api_desired_count
  public_subnet_ids    = module.network.public_subnet_ids
  api_security_group_id = module.network.api_sg_id
  secret_arn           = module.secrets.secret_arn
  rate_limit_max       = var.rate_limit_max
  rate_limit_window    = var.rate_limit_window
}
