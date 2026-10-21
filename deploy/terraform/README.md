# Deploy Prism to AWS

This configuration deploys the Prism server and web application on ECS Fargate,
Redis on ElastiCache, and a public HTTPS Application Load Balancer. It creates a
VPC, public and private subnets in two availability zones, one NAT gateway,
security groups, DNS validation records, and CloudWatch log groups.

## Prerequisites

- Terraform 1.6 or newer.
- AWS CLI credentials with permissions to manage VPC, ECS, IAM, ElastiCache,
  ACM, Route53, CloudWatch Logs, and load balancers.
- A Route53 hosted zone for a domain you control.
- Docker and an ECR repository for each application.
- An AWS account with sufficient quota for Fargate, NAT gateways, and Redis.

Terraform state contains the Redis authentication token and can also contain
the optional AI API key. Use an encrypted, access-controlled remote state
backend in production; do not commit `terraform.tfvars` or state files.

## 1. Build and publish application images

Set the account, region, and hostname values first:

```sh
export AWS_REGION=us-east-1
export AWS_ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
export DOMAIN_NAME=prism.example.com
export ECR_REGISTRY="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"
```

Create the repositories and authenticate Docker:

```sh
aws ecr create-repository --repository-name prism-server --region "$AWS_REGION"
aws ecr create-repository --repository-name prism-web --region "$AWS_REGION"
aws ecr get-login-password --region "$AWS_REGION" |
  docker login --username AWS --password-stdin "$ECR_REGISTRY"
```

Build and push images from the repository root. The web API URL is compiled into
the Next.js client bundle, so set it to the public application hostname:

```sh
docker build -t "$ECR_REGISTRY/prism-server:latest" -f apps/server/Dockerfile .
docker build \
  --build-arg NEXT_PUBLIC_API_URL="https://${DOMAIN_NAME}" \
  -t "$ECR_REGISTRY/prism-web:latest" \
  -f apps/web/Dockerfile .
docker push "$ECR_REGISTRY/prism-server:latest"
docker push "$ECR_REGISTRY/prism-web:latest"
```

The load balancer routes `/api/*` and `/health` to the server and other paths to
the web application. The server image listens on port 3001; the web image
listens on port 3000.

## 2. Configure Terraform

Create a `terraform.tfvars` file in this directory (it is ignored by Git):

```hcl
aws_region        = "us-east-1"
domain_name       = "prism.example.com"
route53_zone_id   = "Z0123456789EXAMPLE"
server_image      = "123456789012.dkr.ecr.us-east-1.amazonaws.com/prism-server:latest"
web_image         = "123456789012.dkr.ecr.us-east-1.amazonaws.com/prism-web:latest"
redis_auth_token  = "replace-with-16-or-more-random-letters"
# ai_api_key       = "optional-provider-key"
```

Generate a strong alphanumeric Redis token (at least 16 characters). The
configuration marks secret variables as sensitive, but Terraform state still
contains their values.

## 3. Deploy

Run from this directory:

```sh
terraform init
terraform validate
terraform plan
terraform apply
```

Approve the plan to create the resources. ACM validates the hostname through
Route53, which can take several minutes. After apply completes, open the
`application_url` output. The ECS services run two tasks each in private
subnets; Redis is reachable only from the server security group.

To update an application, publish a new image tag, update the corresponding
`server_image` or `web_image` value, and apply again. To tear down the
deployment, run `terraform destroy`.

## Cost and operations

The NAT gateway and load balancer incur ongoing charges; ElastiCache is
configured as a two-node, multi-AZ Redis replication group. Logs are retained
for 30 days. Review AWS quotas, pricing, and the Terraform plan before applying.
