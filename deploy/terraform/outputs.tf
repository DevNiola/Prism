output "application_url" {
  description = "HTTPS URL for the Prism web application."
  value       = "https://${var.domain_name}"
}

output "load_balancer_dns_name" {
  description = "DNS name of the public Application Load Balancer."
  value       = module.load_balancer.dns_name
}

output "redis_primary_endpoint" {
  description = "Private Redis endpoint address."
  value       = module.redis.primary_endpoint
}
