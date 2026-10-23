output "security_group_id" {
  value = aws_security_group.this.id
}

output "server_target_group_arn" {
  value = aws_lb_target_group.server.arn
}

output "web_target_group_arn" {
  value = aws_lb_target_group.web.arn
}

output "dns_name" {
  value = aws_lb.this.dns_name
}
