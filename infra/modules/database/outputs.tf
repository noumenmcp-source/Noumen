output "database_url" {
  value     = "postgres://${var.database_username}:${var.database_password}@${aws_db_instance.postgres.address}:5432/${var.database_name}"
  sensitive = true
}
