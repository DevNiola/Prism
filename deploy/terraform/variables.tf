variable "aws_region" {
  description = "AWS region in which to deploy Prism."
  type        = string
  default     = "us-east-1"
}

variable "name" {
  description = "Prefix used to name AWS resources."
  type        = string
  default     = "prism"
}

variable "domain_name" {
  description = "Fully qualified hostname served by the load balancer, such as prism.example.com."
  type        = string
}

variable "route53_zone_id" {
  description = "ID of the existing Route53 hosted zone for domain_name."
  type        = string
}

variable "server_image" {
  description = "Container image URI for the Prism server."
  type        = string
}

variable "web_image" {
  description = "Container image URI for the Prism web application."
  type        = string
}

variable "redis_auth_token" {
  description = "Redis AUTH token. Use 16-128 alphanumeric characters."
  type        = string
  sensitive   = true

  validation {
    condition     = can(regex("^[A-Za-z0-9]{16,128}$", var.redis_auth_token))
    error_message = "redis_auth_token must contain 16-128 alphanumeric characters."
  }
}

variable "ai_api_key" {
  description = "Optional API key for the server's AI provider."
  type        = string
  sensitive   = true
  default     = ""
}

variable "server_cpu" {
  description = "CPU units for the server task."
  type        = number
  default     = 512
}

variable "server_memory" {
  description = "Memory in MiB for the server task."
  type        = number
  default     = 1024
}

variable "web_cpu" {
  description = "CPU units for the web task."
  type        = number
  default     = 512
}

variable "web_memory" {
  description = "Memory in MiB for the web task."
  type        = number
  default     = 1024
}
