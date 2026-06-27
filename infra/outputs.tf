output "api_url" {
  description = "Public URL for the API load balancer."
  value       = module.api_service.api_url
}

output "healthcheck_url" {
  description = "API healthcheck endpoint."
  value       = "${module.api_service.api_url}/v1/health"
}
