#!/usr/bin/env bash
set -euo pipefail

# Cleanup Production Resources for Fresh Deployment
# This script removes all existing production resources that conflict with CDK deployment

REGION="us-east-1"

echo "🧹 Cleaning up production resources for fresh CDK deployment..."
echo "⚠️  This will DELETE existing production resources!"
echo ""

read -p "Are you sure you want to proceed? Type 'YES' to continue: " confirm
if [[ "$confirm" != "YES" ]]; then
    echo "❌ Cleanup cancelled"
    exit 1
fi

echo ""
echo "🗑️  Deleting DynamoDB tables..."

# DynamoDB Tables
TABLES=(
    "enabl-integrations-prod"
    "enabl-user-preferences-production"
    "enabl-reminders-production"
    "enabl-appointments-prod"
    "enabl-documents-prod"
    "enabl-users-prod"
    "enabl-chat-prod"
)

for table in "${TABLES[@]}"; do
    echo "   Deleting table: $table"
    aws dynamodb delete-table --table-name "$table" --region "$REGION" 2>/dev/null || echo "   ⚠️  Table $table not found or already deleted"
done

echo ""
echo "🗑️  Deleting S3 buckets..."

# S3 Buckets
BUCKETS=(
    "enabl-knowledge-base-production"
    "enabl-documents-prod"
    "enabl-user-uploads-prod"
    "enabl-backups-prod"
)

for bucket in "${BUCKETS[@]}"; do
    echo "   Deleting bucket: $bucket"
    # First delete all objects in the bucket
    aws s3 rm s3://"$bucket" --recursive --region "$REGION" 2>/dev/null || echo "   ⚠️  No objects to delete in $bucket"
    # Then delete the bucket
    aws s3 rb s3://"$bucket" --force --region "$REGION" 2>/dev/null || echo "   ⚠️  Bucket $bucket not found or already deleted"
done

echo ""
echo "⏳ Waiting for DynamoDB tables to be fully deleted..."
for table in "${TABLES[@]}"; do
    echo "   Waiting for $table..."
    aws dynamodb wait table-not-exists --table-name "$table" --region "$REGION" 2>/dev/null || echo "   ✅ $table already deleted"
done

echo ""
echo "🔍 Checking for any remaining CloudFormation stack..."
aws cloudformation delete-stack --stack-name enabl-backend-production --region "$REGION" 2>/dev/null || echo "   ✅ No stack to delete"

echo ""
echo "⏳ Waiting 30 seconds for cleanup to propagate..."
sleep 30

echo ""
echo "✅ Cleanup completed! You can now run:"
echo "   npx cdk deploy EnablBackend-production --context environment=production --require-approval never"
