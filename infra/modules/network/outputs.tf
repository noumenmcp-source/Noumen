output "public_subnet_ids" {
  value = aws_subnet.public[*].id
}

output "private_subnet_ids" {
  value = aws_subnet.private[*].id
}

output "api_sg_id" {
  value = aws_security_group.api.id
}

output "database_sg_id" {
  value = aws_security_group.database.id
}
