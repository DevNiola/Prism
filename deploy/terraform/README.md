# AWS Terraform Infrastructure for Grat (Prism)

Production-ready Terraform configuration deploying Grat on AWS using **ECS Fargate**, **Application Load Balancer (ALB)**, and **Amazon ElastiCache for Redis**.

---

## Architecture Overview

```
                          Internet (Clients / Browsers)
                                      │
                                      ▼
                        [Application Load Balancer]
                         (HTTP :80 / HTTPS :443)
                                ╱           ╲
                 Path: /*      ╱             ╲  Path: /api/*, /ws*
                              ▼               ▼
                        [TG: Web :3000]   [TG: Server :3001]
                              │                   │
                              ▼                   ▼
                      ECS Fargate (Web)    ECS Fargate (Server)
                                                  │
                                                  ▼ (Port 6379)
                                          [ElastiCache Redis]
                                          (BullMQ Queues & Cache)
```

- **Networking**: VPC across 2 Availability Zones with dedicated public and private subnets.
- **Compute**: ECS Fargate serverless containers running Grat Web (`:3000`) and Grat Server (`:3001`).
- **Load Balancing**: Dual-target ALB with path-based routing (`/api/*` and `/ws*` routed to backend server; `/*` routed to Next.js frontend).
- **Caching & Queues**: AWS ElastiCache Redis cluster for asynchronous task processing and state caching.
- **Logging**: Dedicated AWS CloudWatch Log Groups with 30-day retention.
- **Security**: Granular Security Groups isolating database, container tasks, and load balancer traffic.
- **DNS / SSL**: Optional Route53 alias and ACM certificate provisioning.

---

## Prerequisites

1. **Terraform**: `>= 1.5.0` installed.
2. **AWS CLI**: Authenticated with appropriate permissions (`AdministratorAccess` or scoped IAM role).
3. **Container Images**: Docker images built and pushed to ECR or GitHub Container Registry (GHCR).

---

## Quickstart Deployment

### 1. Initialize Terraform
```bash
cd deploy/terraform
terraform init
```

### 2. Plan Infrastructure
```bash
terraform plan -out=tfplan \
  -var="aws_region=us-east-1" \
  -var="environment=production" \
  -var="server_image=ghcr.io/devniola/grat-server:latest" \
  -var="web_image=ghcr.io/devniola/grat-web:latest"
```

### 3. Apply Configuration
```bash
terraform apply tfplan
```

### 4. Verify Access
After deployment completes, check the load balancer DNS name in outputs:
```bash
terraform output alb_dns_name
```
Navigate to `http://<alb_dns_name>/` in your browser.

---

## Configuration Variables

| Name | Description | Default |
| :--- | :--- | :--- |
| `aws_region` | Target AWS region | `us-east-1` |
| `environment` | Deployment environment tag | `production` |
| `project_name` | Resource prefix | `grat-prism` |
| `vpc_cidr` | Virtual Private Cloud CIDR block | `10.0.0.0/16` |
| `server_image` | Docker image URI for server API | `ghcr.io/devniola/grat-server:latest` |
| `web_image` | Docker image URI for web frontend | `ghcr.io/devniola/grat-web:latest` |
| `redis_node_type` | ElastiCache Redis instance type | `cache.t4g.micro` |
| `domain_name` | Custom domain name for Route53/ACM | `""` (ALB DNS used if empty) |

---

## Teardown
To destroy all provisioned AWS resources:
```bash
terraform destroy \
  -var="aws_region=us-east-1" \
  -var="environment=production"
```
