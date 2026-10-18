output "alb_dns_name" {
  description = "The public DNS address of the Application Load Balancer"
  value       = aws_lb.main.dns_name
}

output "alb_zone_id" {
  description = "The canonical hosted zone ID of the load balancer"
  value       = aws_lb.main.zone_id
}

output "ecs_cluster_name" {
  description = "The name of the ECS cluster"
  value       = aws_ecs_cluster.main.name
}

output "redis_primary_endpoint" {
  description = "Primary endpoint address for ElastiCache Redis"
  value       = aws_elasticache_replication_group.redis.primary_endpoint_address
}

output "redis_port" {
  description = "Port for ElastiCache Redis"
  value       = aws_elasticache_replication_group.redis.port
}

output "web_service_name" {
  description = "The ECS service name for Grat Web UI"
  value       = aws_ecs_service.web.name
}

output "server_service_name" {
  description = "The ECS service name for Grat Server API"
  value       = aws_ecs_service.server.name
}
