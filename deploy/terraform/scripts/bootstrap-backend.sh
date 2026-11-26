#!/usr/bin/env bash
# bootstrap-backend.sh — Create the S3 bucket and DynamoDB table required for
# Terraform remote state before the first `terraform init`.
#
# Usage:
#   TF_STATE_BUCKET=my-prism-tfstate \
#   TF_LOCK_TABLE=prism-tf-locks \
#   AWS_REGION=us-east-1 \
#   ./scripts/bootstrap-backend.sh

set -euo pipefail

: "${TF_STATE_BUCKET:?Set TF_STATE_BUCKET}"
: "${TF_LOCK_TABLE:?Set TF_LOCK_TABLE}"
: "${AWS_REGION:?Set AWS_REGION}"

echo "→ Creating S3 bucket: ${TF_STATE_BUCKET} in ${AWS_REGION}"
if [ "${AWS_REGION}" = "us-east-1" ]; then
  aws s3api create-bucket \
    --bucket "${TF_STATE_BUCKET}" \
    --region "${AWS_REGION}"
else
  aws s3api create-bucket \
    --bucket "${TF_STATE_BUCKET}" \
    --region "${AWS_REGION}" \
    --create-bucket-configuration "LocationConstraint=${AWS_REGION}"
fi

echo "→ Enabling versioning on ${TF_STATE_BUCKET}"
aws s3api put-bucket-versioning \
  --bucket "${TF_STATE_BUCKET}" \
  --versioning-configuration Status=Enabled

echo "→ Enabling AES256 encryption on ${TF_STATE_BUCKET}"
aws s3api put-bucket-encryption \
  --bucket "${TF_STATE_BUCKET}" \
  --server-side-encryption-configuration \
    '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'

echo "→ Blocking public access on ${TF_STATE_BUCKET}"
aws s3api put-public-access-block \
  --bucket "${TF_STATE_BUCKET}" \
  --public-access-block-configuration \
    "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"

echo "→ Creating DynamoDB lock table: ${TF_LOCK_TABLE}"
aws dynamodb create-table \
  --table-name "${TF_LOCK_TABLE}" \
  --attribute-definitions AttributeName=LockID,AttributeType=S \
  --key-schema AttributeName=LockID,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --region "${AWS_REGION}"

echo "✓ Backend bootstrap complete."
echo ""
echo "Run terraform init with:"
echo "  terraform init \\"
echo "    -backend-config=\"bucket=${TF_STATE_BUCKET}\" \\"
echo "    -backend-config=\"key=prism/terraform.tfstate\" \\"
echo "    -backend-config=\"region=${AWS_REGION}\" \\"
echo "    -backend-config=\"dynamodb_table=${TF_LOCK_TABLE}\" \\"
echo "    -backend-config=\"encrypt=true\""
