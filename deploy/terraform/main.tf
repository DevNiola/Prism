data "aws_availability_zones" "available" {
  state = "available"
}

module "network" {
  source = "./modules/network"

  name               = var.name
  availability_zones = slice(data.aws_availability_zones.available.names, 0, 2)
}

resource "aws_security_group" "server" {
  name        = "${var.name}-server"
  description = "Prism server ingress from the load balancer."
  vpc_id      = module.network.vpc_id

  ingress {
    description     = "Server HTTP from ALB"
    from_port       = 3001
    to_port         = 3001
    protocol        = "tcp"
    security_groups = [module.load_balancer.security_group_id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_security_group" "web" {
  name        = "${var.name}-web"
  description = "Prism web ingress from the load balancer."
  vpc_id      = module.network.vpc_id

  ingress {
    description     = "Web HTTP from ALB"
    from_port       = 3000
    to_port         = 3000
    protocol        = "tcp"
    security_groups = [module.load_balancer.security_group_id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

module "redis" {
  source = "./modules/redis"

  name               = var.name
  subnet_ids         = module.network.private_subnet_ids
  vpc_id             = module.network.vpc_id
  client_security_id = aws_security_group.server.id
  auth_token         = var.redis_auth_token
}

module "load_balancer" {
  source = "./modules/load-balancer"

  name              = var.name
  vpc_id            = module.network.vpc_id
  public_subnet_ids = module.network.public_subnet_ids
  domain_name       = var.domain_name
  route53_zone_id   = var.route53_zone_id
}

resource "aws_ecs_cluster" "this" {
  name = "${var.name}-cluster"
}

module "server" {
  source = "./modules/ecs-service"

  name                 = "${var.name}-server"
  cluster_arn          = aws_ecs_cluster.this.arn
  image                = var.server_image
  container_port       = 3001
  cpu                  = var.server_cpu
  memory               = var.server_memory
  subnet_ids           = module.network.private_subnet_ids
  security_group_ids   = [aws_security_group.server.id]
  target_group_arn     = module.load_balancer.server_target_group_arn
  environment_variables = {
    PORT      = "3001"
    REDIS_URL = "redis://:${var.redis_auth_token}@${module.redis.primary_endpoint}:6379"
    AI_API_KEY = var.ai_api_key
  }
}

module "web" {
  source = "./modules/ecs-service"

  name                 = "${var.name}-web"
  cluster_arn          = aws_ecs_cluster.this.arn
  image                = var.web_image
  container_port       = 3000
  cpu                  = var.web_cpu
  memory               = var.web_memory
  subnet_ids           = module.network.private_subnet_ids
  security_group_ids   = [aws_security_group.web.id]
  target_group_arn     = module.load_balancer.web_target_group_arn
  environment_variables = {}
}
