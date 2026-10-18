variable "aws_region" {
  description = "The AWS region to deploy resources in"
  type        = string
  default     = "us-east-1"
}

variable "environment" {
  description = "Environment name (e.g. staging, production)"
  type        = string
  default     = "production"
}

variable "project_name" {
  description = "Project identifier used in resource names"
  type        = string
  default     = "grat-prism"
}

variable "vpc_cidr" {
  description = "CIDR block for the VPC"
  type        = string
  default     = "10.0.0.0/16"
}

variable "domain_name" {
  description = "Optional domain name for Route53 and ACM (leave empty to use ALB DNS directly)"
  type        = string
  default     = ""
}

variable "server_image" {
  description = "Docker image repository URL for the Grat server service"
  type        = string
  default     = "ghcr.io/devniola/grat-server:latest"
}

variable "web_image" {
  description = "Docker image repository URL for the Grat web UI service"
  type        = string
  default     = "ghcr.io/devniola/grat-web:latest"
}

variable "server_cpu" {
  description = "Fargate CPU units for the server task (1024 = 1 vCPU)"
  type        = number
  default     = 512
}

variable "server_memory" {
  description = "Fargate Memory (MB) for the server task"
  type        = number
  default     = 1024
}

variable "web_cpu" {
  description = "Fargate CPU units for the web UI task"
  type        = number
  default     = 512
}

variable "web_memory" {
  description = "Fargate Memory (MB) for the web UI task"
  type        = number
  default     = 1024
}

variable "redis_node_type" {
  description = "ElastiCache Redis node type"
  type        = string
  default     = "cache.t4g.micro"
}
