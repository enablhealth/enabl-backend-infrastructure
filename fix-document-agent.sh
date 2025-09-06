#!/bin/bash

# Fix Document Agent Issues
# This script addresses the document summarization problems by:
# 1. Updating environment variables
# 2. Fixing table name references
# 3. Updating model to Nova Pro
# 4. Deploying the updated infrastructure

set -e

echo "🔧 Fixing Document Agent Issues..."
echo "=================================="

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Determine environment
ENVIRONMENT=${1:-dev}
if [ "$ENVIRONMENT" = "development" ]; then
    ENVIRONMENT="dev"
fi
echo -e "${BLUE}Environment: ${ENVIRONMENT}${NC}"

# Deploy the updated infrastructure
echo -e "${YELLOW}📦 Deploying updated Bedrock Agents Stack...${NC}"
npx cdk deploy EnablHealthStack-${ENVIRONMENT} --require-approval never

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ Document Agent infrastructure updated successfully!${NC}"
else
    echo -e "${RED}❌ Failed to deploy infrastructure updates${NC}"
    exit 1
fi

# Summary of fixes applied
echo ""
echo -e "${GREEN}🎉 Document Agent Fixes Applied:${NC}"
echo "=================================="
echo "✅ Updated model to amazon.nova-pro-v1:0 for ChatGPT-level analysis"
echo "✅ Added missing DOCUMENTS_TABLE environment variable"
echo "✅ Added USER_UPLOADS_BUCKET environment variable"
echo "✅ Fixed DynamoDB table name resolution"
echo "✅ Enhanced logging for debugging document retrieval"
echo "✅ Improved S3 bucket resolution for user uploads"
echo "✅ Added comprehensive error handling and logging"

echo ""
echo -e "${BLUE}📋 Testing Instructions:${NC}"
echo "1. Upload a document through the chat interface"
echo "2. Ask: 'Please summarize this document'"
echo "3. The agent should now properly retrieve and analyze your document"
echo "4. Check CloudWatch logs if issues persist"

echo ""
echo -e "${YELLOW}📊 Monitor deployment:${NC}"
echo "AWS Console → CloudWatch → Log Groups → /aws/lambda/EnablHealthStack-${ENVIRONMENT}-DocumentAgentFunction"

echo ""
echo -e "${GREEN}🚀 Document Agent is now ready for enhanced document analysis!${NC}"
