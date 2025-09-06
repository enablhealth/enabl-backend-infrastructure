#!/bin/bash

# Phase 3 Deployment: OpenSearch Vector Embeddings + Bedrock Knowledge Base
# This script deploys the enhanced infrastructure for semantic search and personalized RAG

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
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

# Get environment (default to development)
ENVIRONMENT=${1:-development}

print_status "🚀 Starting Phase 3 deployment for environment: $ENVIRONMENT"

# Validate environment
if [[ ! "$ENVIRONMENT" =~ ^(development|staging|production)$ ]]; then
    print_error "Invalid environment. Use: development, staging, or production"
    exit 1
fi

# Change to infrastructure directory
cd "$(dirname "$0")"

# Ensure we're in the right directory
if [ ! -f "cdk.json" ]; then
    print_error "CDK configuration not found. Please run from the infrastructure directory."
    exit 1
fi

print_status "📦 Installing dependencies..."
npm install

print_status "🔧 Building TypeScript..."
npm run build

print_status "🔍 Validating CDK configuration..."
npx cdk list --context environment=$ENVIRONMENT

# Deploy OpenSearch Vector Stack first
print_status "🔍 Deploying OpenSearch Vector Stack..."
npx cdk deploy EnablOpenSearchVectorStack-$ENVIRONMENT \
    --app="node dist/bin/enabl-vector-app.js" \
    --context environment=$ENVIRONMENT \
    --require-approval never \
    --outputs-file opensearch-outputs-$ENVIRONMENT.json

if [ $? -eq 0 ]; then
    print_success "OpenSearch Vector Stack deployed successfully"
else
    print_error "OpenSearch Vector Stack deployment failed"
    exit 1
fi

# Get OpenSearch outputs for next stack
OPENSEARCH_ENDPOINT=$(cat opensearch-outputs-$ENVIRONMENT.json | jq -r '.["EnablOpenSearchVectorStack-'$ENVIRONMENT'"].VectorCollectionEndpoint')
OPENSEARCH_ARN=$(cat opensearch-outputs-$ENVIRONMENT.json | jq -r '.["EnablOpenSearchVectorStack-'$ENVIRONMENT'"].VectorCollectionArn')

print_status "📚 Deploying Bedrock Knowledge Base Stack..."
npx cdk deploy EnablBedrockKnowledgeBaseStack-$ENVIRONMENT \
    --app="node dist/bin/enabl-vector-app.js" \
    --context environment=$ENVIRONMENT \
    --require-approval never \
    --outputs-file bedrock-outputs-$ENVIRONMENT.json

if [ $? -eq 0 ]; then
    print_success "Bedrock Knowledge Base Stack deployed successfully"
else
    print_error "Bedrock Knowledge Base Stack deployment failed"
    exit 1
fi

# Create combined outputs file
print_status "📄 Creating combined infrastructure outputs..."
cat > phase3-infrastructure-$ENVIRONMENT.json << EOF
{
  "environment": "$ENVIRONMENT",
  "deployedAt": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "openSearch": {
    "endpoint": "$OPENSEARCH_ENDPOINT",
    "collectionArn": "$OPENSEARCH_ARN"
  },
  "bedrockKnowledgeBase": $(cat bedrock-outputs-$ENVIRONMENT.json | jq '.["EnablBedrockKnowledgeBaseStack-'$ENVIRONMENT'"]'),
  "userKnowledgeBasesTable": "enabl-user-knowledge-bases-$ENVIRONMENT"
}
EOF

# Set up OpenSearch index
print_status "🔧 Setting up OpenSearch index..."
cat > create-opensearch-index.json << EOF
{
  "settings": {
    "index": {
      "knn": true
    }
  },
  "mappings": {
    "properties": {
      "chunk_id": { "type": "keyword" },
      "document_id": { "type": "keyword" },
      "user_id": { "type": "keyword" },
      "content": { "type": "text" },
      "chunk_index": { "type": "integer" },
      "start_offset": { "type": "integer" },
      "end_offset": { "type": "integer" },
      "metadata": {
        "properties": {
          "documentName": { "type": "text" },
          "documentType": { "type": "keyword" },
          "uploadDate": { "type": "date" },
          "medicalCategories": { "type": "keyword" }
        }
      },
      "embedding": {
        "type": "knn_vector",
        "dimension": 1536,
        "method": {
          "name": "hnsw",
          "space_type": "cosinesimil",
          "engine": "nmslib"
        }
      },
      "timestamp": { "type": "date" }
    }
  }
}
EOF

print_warning "Manual step required: Create OpenSearch index using the AWS Console or CLI"
print_status "Index configuration saved to: create-opensearch-index.json"

# Output environment variables for frontend
print_status "📝 Environment variables for frontend:"
cat > frontend-env-$ENVIRONMENT.txt << EOF
# Add these to your .env.local file:
NEXT_PUBLIC_OPENSEARCH_ENDPOINT=$OPENSEARCH_ENDPOINT
OPENSEARCH_COLLECTION_ENDPOINT=$OPENSEARCH_ENDPOINT
OPENSEARCH_COLLECTION_ARN=$OPENSEARCH_ARN
KNOWLEDGE_BASE_BUCKET=$(cat bedrock-outputs-$ENVIRONMENT.json | jq -r '.["EnablBedrockKnowledgeBaseStack-'$ENVIRONMENT'"].KnowledgeBaseBucketName')
KNOWLEDGE_BASE_ROLE_ARN=$(cat bedrock-outputs-$ENVIRONMENT.json | jq -r '.["EnablBedrockKnowledgeBaseStack-'$ENVIRONMENT'"].KnowledgeBaseRoleArn')
DYNAMODB_USER_KNOWLEDGE_BASES_TABLE=enabl-user-knowledge-bases-$ENVIRONMENT
EOF

# Install required npm packages
print_status "📦 Installing required npm packages for webapp..."
cd ../enabl-webapp

# Check if package.json exists
if [ ! -f "package.json" ]; then
    print_error "webapp package.json not found"
    exit 1
fi

# Install AWS SDK packages (mock install since we're using mocks for now)
print_status "Adding AWS SDK packages to package.json..."

# We'll add these as development dependencies for now since we're using mock implementations
npm install --save-dev @types/uuid
npm install uuid

print_success "📱 Phase 3 deployment completed successfully!"

echo ""
echo "🎉 DEPLOYMENT SUMMARY"
echo "===================="
echo "Environment: $ENVIRONMENT"
echo "OpenSearch Endpoint: $OPENSEARCH_ENDPOINT"
echo "Knowledge Base Bucket: $(cat ../enabl-backend-infrastructure/bedrock-outputs-$ENVIRONMENT.json | jq -r '.["EnablBedrockKnowledgeBaseStack-'$ENVIRONMENT'"].KnowledgeBaseBucketName')"
echo ""
echo "📋 NEXT STEPS:"
echo "1. Copy environment variables from frontend-env-$ENVIRONMENT.txt to your .env.local"
echo "2. Create OpenSearch index using create-opensearch-index.json"
echo "3. Test semantic search functionality in the webapp"
echo "4. Upload documents to test vector embeddings"
echo ""
echo "🔗 RESOURCES CREATED:"
echo "• OpenSearch Serverless collection for vector storage"
echo "• S3 bucket for Bedrock Knowledge Base documents"
echo "• DynamoDB table for user knowledge base metadata"
echo "• Lambda function for document processing"
echo "• IAM roles and policies for Bedrock integration"
echo ""
print_success "Phase 3 infrastructure is ready for testing!"
