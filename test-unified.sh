#!/bin/bash

# Test Unified Infrastructure Deployment
# Validates that all key components are accessible

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_status() { echo -e "${BLUE}[TEST]${NC} $1"; }
print_success() { echo -e "${GREEN}[PASS]${NC} $1"; }
print_error() { echo -e "${RED}[FAIL]${NC} $1"; }

ENVIRONMENT=${1:-development}

print_status "🧪 Testing Unified Stack Infrastructure for: $ENVIRONMENT"

# Load outputs
if [ ! -f "enabl-outputs-$ENVIRONMENT.json" ]; then
    print_error "Outputs file not found. Run deployment first."
    exit 1
fi

USER_POOL_ID=$(cat enabl-outputs-$ENVIRONMENT.json | jq -r '.["EnablHealthStack-'$ENVIRONMENT'"].UserPoolId')
MAIN_API=$(cat enabl-outputs-$ENVIRONMENT.json | jq -r '.["EnablHealthStack-'$ENVIRONMENT'"].MainApiEndpoint')
AI_API=$(cat enabl-outputs-$ENVIRONMENT.json | jq -r '.["EnablHealthStack-'$ENVIRONMENT'"].AiApiEndpoint')
VECTOR_ENDPOINT=$(cat enabl-outputs-$ENVIRONMENT.json | jq -r '.["EnablHealthStack-'$ENVIRONMENT'"].VectorCollectionEndpoint')

# Test 1: Cognito User Pool
print_status "Testing Cognito User Pool..."
aws cognito-idp describe-user-pool --user-pool-id $USER_POOL_ID > /dev/null 2>&1
if [ $? -eq 0 ]; then
    print_success "Cognito User Pool accessible: $USER_POOL_ID"
else
    print_error "Cognito User Pool not accessible"
fi

# Test 2: Main API Gateway
print_status "Testing Main API Gateway..."
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" $MAIN_API || echo "000")
if [ "$HTTP_STATUS" != "000" ]; then
    print_success "Main API accessible: $MAIN_API (Status: $HTTP_STATUS)"
else
    print_error "Main API not accessible"
fi

# Test 3: AI API Gateway  
print_status "Testing AI API Gateway..."
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" $AI_API || echo "000")
if [ "$HTTP_STATUS" != "000" ]; then
    print_success "AI API accessible: $AI_API (Status: $HTTP_STATUS)"
else
    print_error "AI API not accessible"
fi

# Test 4: OpenSearch Collection
print_status "Testing OpenSearch Collection..."
if [[ $VECTOR_ENDPOINT == *"aoss.amazonaws.com"* ]]; then
    print_success "OpenSearch Collection endpoint valid: $VECTOR_ENDPOINT"
else
    print_error "OpenSearch Collection endpoint invalid"
fi

# Test 5: DynamoDB Tables
print_status "Testing DynamoDB Tables..."
TABLES=("enabl-users-$ENVIRONMENT" "enabl-chat-history-$ENVIRONMENT" "enabl-documents-$ENVIRONMENT" "enabl-appointments-$ENVIRONMENT")

for table in "${TABLES[@]}"; do
    aws dynamodb describe-table --table-name $table > /dev/null 2>&1
    if [ $? -eq 0 ]; then
        print_success "DynamoDB table accessible: $table"
    else
        print_error "DynamoDB table not accessible: $table"
    fi
done

# Test 6: S3 Buckets
print_status "Testing S3 Buckets..."
BUCKETS=("enabl-documents-$ENVIRONMENT-775525057465" "enabl-knowledge-base-$ENVIRONMENT-775525057465")

for bucket in "${BUCKETS[@]}"; do
    aws s3 ls s3://$bucket > /dev/null 2>&1
    if [ $? -eq 0 ]; then
        print_success "S3 bucket accessible: $bucket"
    else
        print_error "S3 bucket not accessible: $bucket"
    fi
done

print_status "✅ Infrastructure testing complete!"
