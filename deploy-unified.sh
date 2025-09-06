#!/bin/bash

# Unified Deployment Script - Single Stack Approach
# This replaces all the complex multi-stack deployments

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_status() { echo -e "${BLUE}[INFO]${NC} $1"; }
print_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
print_warning() { echo -e "${YELLOW}[WARNING]${NC} $1"; }
print_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Default to development if no environment specified
ENVIRONMENT=${1:-development}

if [[ ! "$ENVIRONMENT" =~ ^(development|staging|production)$ ]]; then
    print_error "Invalid environment. Use: development, staging, or production"
    exit 1
fi

print_status "🚀 Deploying Unified Enabl Health Stack for environment: $ENVIRONMENT"

# Build TypeScript
print_status "🔧 Building TypeScript..."
npm run build

# Deploy single unified stack
print_status "🎯 Deploying unified stack..."
npx cdk deploy EnablHealthStack-$ENVIRONMENT \
    --app="node dist/bin/enabl-unified-app.js" \
    --context environment=$ENVIRONMENT \
    --require-approval never \
    --outputs-file enabl-outputs-$ENVIRONMENT.json

if [ $? -eq 0 ]; then
    print_success "✅ Deployment completed successfully!"
    
    # Extract key values for frontend configuration
    print_status "📝 Generating environment configuration..."
    
    USER_POOL_ID=$(cat enabl-outputs-$ENVIRONMENT.json | jq -r '.["EnablHealthStack-'$ENVIRONMENT'"].UserPoolId')
    USER_POOL_CLIENT_ID=$(cat enabl-outputs-$ENVIRONMENT.json | jq -r '.["EnablHealthStack-'$ENVIRONMENT'"].UserPoolClientId')
    MAIN_API_ENDPOINT=$(cat enabl-outputs-$ENVIRONMENT.json | jq -r '.["EnablHealthStack-'$ENVIRONMENT'"].MainApiEndpoint')
    AI_API_ENDPOINT=$(cat enabl-outputs-$ENVIRONMENT.json | jq -r '.["EnablHealthStack-'$ENVIRONMENT'"].AiApiEndpoint')
    VECTOR_ENDPOINT=$(cat enabl-outputs-$ENVIRONMENT.json | jq -r '.["EnablHealthStack-'$ENVIRONMENT'"].VectorCollectionEndpoint')
    DOCUMENTS_BUCKET=$(cat enabl-outputs-$ENVIRONMENT.json | jq -r '.["EnablHealthStack-'$ENVIRONMENT'"].DocumentsBucketName')
    KNOWLEDGE_BASE_BUCKET=$(cat enabl-outputs-$ENVIRONMENT.json | jq -r '.["EnablHealthStack-'$ENVIRONMENT'"].KnowledgeBaseBucketName')
    KB_ROLE_ARN=$(cat enabl-outputs-$ENVIRONMENT.json | jq -r '.["EnablHealthStack-'$ENVIRONMENT'"].KnowledgeBaseRoleArn')
    
    # Generate frontend environment file
    cat > ../enabl-webapp/frontend-env-$ENVIRONMENT.txt << EOF
# Enabl Health - $ENVIRONMENT Environment Configuration
# Copy these values to your .env.local file

NEXT_PUBLIC_API_URL=$MAIN_API_ENDPOINT
NEXT_PUBLIC_AI_API_URL=$AI_API_ENDPOINT
NEXT_PUBLIC_COGNITO_USER_POOL_ID=$USER_POOL_ID
NEXT_PUBLIC_COGNITO_USER_POOL_CLIENT_ID=$USER_POOL_CLIENT_ID
NEXT_PUBLIC_OPENSEARCH_ENDPOINT=$VECTOR_ENDPOINT
NEXT_PUBLIC_DOCUMENTS_BUCKET=$DOCUMENTS_BUCKET
NEXT_PUBLIC_KNOWLEDGE_BASE_BUCKET=$KNOWLEDGE_BASE_BUCKET
NEXT_PUBLIC_APP_ENV=$ENVIRONMENT
NODE_ENV=production

# Knowledge Base Setup (Manual)
# Use the following values to create Bedrock Knowledge Base manually:
# - Role ARN: $KB_ROLE_ARN
# - Collection ARN: (from OpenSearch Console)
# - Index Name: enabl-health-index
EOF

    print_success "🎉 Environment configuration saved to ../enabl-webapp/frontend-env-$ENVIRONMENT.txt"
    print_status "📋 Infrastructure Summary:"
    echo "   • User Pool ID: $USER_POOL_ID"
    echo "   • Main API: $MAIN_API_ENDPOINT"
    echo "   • AI API: $AI_API_ENDPOINT"
    echo "   • Vector Search: $VECTOR_ENDPOINT"
    echo "   • Documents Bucket: $DOCUMENTS_BUCKET"
    echo "   • Knowledge Base Bucket: $KNOWLEDGE_BASE_BUCKET"
    echo "   • KB Role ARN: $KB_ROLE_ARN"
    
    print_warning "⚠️  Knowledge Base needs manual setup:"
    echo "   1. Create index 'enabl-health-index' in OpenSearch"
    echo "   2. Create Bedrock Knowledge Base using provided Role ARN"
    
else
    print_error "❌ Deployment failed"
    exit 1
fi
