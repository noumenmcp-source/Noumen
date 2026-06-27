resource "aws_secretsmanager_secret" "api_env" {
  name = "${var.name_prefix}/api-env"
}

resource "aws_secretsmanager_secret_version" "api_env" {
  secret_id = aws_secretsmanager_secret.api_env.id
  secret_string = jsonencode({
    DATABASE_URL        = var.database_url
    RESEND_API_KEY      = var.resend_api_key
    AI_GATEWAY_BASE_URL = var.ai_gateway_base_url
    AI_GATEWAY_API_KEY  = var.ai_gateway_api_key
  })
}
