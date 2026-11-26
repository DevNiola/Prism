terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # ---------------------------------------------------------------------------
  # Remote state backend (S3 + DynamoDB locking)
  #
  # Bootstrap the backend resources once before running terraform init:
  #   aws s3api create-bucket \
  #     --bucket <TF_STATE_BUCKET> \
  #     --region <AWS_REGION> \
  #     --create-bucket-configuration LocationConstraint=<AWS_REGION>
  #   aws s3api put-bucket-versioning \
  #     --bucket <TF_STATE_BUCKET> \
  #     --versioning-configuration Status=Enabled
  #   aws s3api put-bucket-encryption \
  #     --bucket <TF_STATE_BUCKET> \
  #     --server-side-encryption-configuration \
  #       '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
  #   aws dynamodb create-table \
  #     --table-name <TF_LOCK_TABLE> \
  #     --attribute-definitions AttributeName=LockID,AttributeType=S \
  #     --key-schema AttributeName=LockID,KeyType=HASH \
  #     --billing-mode PAY_PER_REQUEST \
  #     --region <AWS_REGION>
  #
  # Then initialise with backend config passed at init time:
  #   terraform init \
  #     -backend-config="bucket=<TF_STATE_BUCKET>" \
  #     -backend-config="key=prism/terraform.tfstate" \
  #     -backend-config="region=<AWS_REGION>" \
  #     -backend-config="dynamodb_table=<TF_LOCK_TABLE>" \
  #     -backend-config="encrypt=true"
  #
  # For local development without remote state, run:
  #   terraform init   (omit -backend-config flags)
  # ---------------------------------------------------------------------------
  backend "s3" {}
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "prism"
      ManagedBy   = "terraform"
      Environment = var.environment
    }
  }
}
