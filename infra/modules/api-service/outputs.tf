output "api_url" {
  value = "http://${aws_lb.api.dns_name}"
}
