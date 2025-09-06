#!/bin/bash

# Enabl Health Unified Infrastructure Deployment Script
# This script deploys the unified stack that imports existing resources

set -e

echo "🚀 Deploying Enabl Health Unified Infrastructure"
echo "=============================================="

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Environment to deploy (default: dev)
ENVIRONMENT=${1:-dev}

print_status "Building TypeScript code..."
npm run build

print_status "Deploying EnablHealthStack-${ENVIRONMENT}..."
npx cdk deploy EnablHealthStack-${ENVIRONMENT} --require-approval never

# Check deployment success
if [ $? -eq 0 ]; then
    print_success "✅ Deployment completed successfully!"
    
    print_status "Getting stack outputs..."
    aws cloudformation describe-stacks \
        --stack-name EnablHealthStack-${ENVIRONMENT} \
        --query 'Stacks[0].Outputs' \
        --output table
        
    print_status "Deployment Summary:"
    echo "==================="
    echo "✅ Environment: ${ENVIRONMENT}"
    echo "✅ Imported existing DynamoDB tables (enabl-users-${ENVIRONMENT})"
    echo "✅ Imported existing S3 buckets (enabl-documents-${ENVIRONMENT})"
    echo "✅ Imported existing Cognito User Pool"
    echo "✅ Imported existing API Gateways"
    echo "✅ Created new OpenSearch Serverless collection"
    echo "✅ Created IAM roles for Bedrock integration"
    
    print_success "🎉 Unified infrastructure successfully deployed!"
    print_warning "Next steps:"
    echo "  1. Update frontend environment variables with new stack outputs"
    echo "  2. Test API integrations"
    echo "  3. Deploy staging environment: ./deploy-unified-import.sh staging"
    echo "  4. Deploy production environment: ./deploy-unified-import.sh production"
    
else
    print_error "❌ Deployment failed!"
    exit 1
fi
