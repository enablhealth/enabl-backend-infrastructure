#!/bin/bash

# Deploy Enabl Health AI Agents Infrastructure
# This script deploys the complete AI agents stack with Bedrock integration

set -e

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Default environment
ENVIRONMENT=${1:-dev}

echo -e "${BLUE}🤖 Deploying Enabl Health AI Agents Infrastructure${NC}"
echo -e "${BLUE}Environment: ${ENVIRONMENT}${NC}"
echo ""

# Validate environment
if [[ ! "$ENVIRONMENT" =~ ^(dev|staging|prod)$ ]]; then
    echo -e "${RED}❌ Invalid environment. Use: dev, staging, or prod${NC}"
    exit 1
fi

# Check if AWS CLI is configured
if ! aws sts get-caller-identity >/dev/null 2>&1; then
    echo -e "${RED}❌ AWS CLI not configured. Please run 'aws configure'${NC}"
    exit 1
fi

# Check if CDK is installed
if ! command -v cdk &> /dev/null; then
    echo -e "${RED}❌ AWS CDK not installed. Please run 'npm install -g aws-cdk'${NC}"
    exit 1
fi

echo -e "${YELLOW}📋 Pre-deployment checklist:${NC}"
echo "✅ AWS CLI configured"
echo "✅ CDK installed"
echo "✅ Environment validated: $ENVIRONMENT"
echo ""

# Install Lambda dependencies
echo -e "${YELLOW}📦 Installing Lambda dependencies...${NC}"
cd lib/lambda
npm install
cd ../..

# Build the project
echo -e "${YELLOW}🔨 Building CDK project...${NC}"
npm run build

# Bootstrap if needed (only for first deployment)
if [ "$ENVIRONMENT" = "dev" ] && [ ! -f ".cdk-bootstrapped" ]; then
    echo -e "${YELLOW}🚀 Bootstrapping CDK (first time only)...${NC}"
    cdk bootstrap
    touch .cdk-bootstrapped
fi

# Deploy the stack
echo -e "${YELLOW}🚀 Deploying AI Agents infrastructure...${NC}"
cdk deploy EnablBackend-$ENVIRONMENT --require-approval never

# Check if Bedrock models are available
echo -e "${YELLOW}🔍 Checking Bedrock model availability...${NC}"
aws bedrock list-foundation-models --region us-east-1 --query 'modelSummaries[?contains(modelId, `anthropic.claude-3-sonnet`)].modelId' --output text

echo ""
echo -e "${GREEN}✅ AI Agents infrastructure deployed successfully!${NC}"
echo ""
echo -e "${BLUE}📋 Next Steps:${NC}"
echo "1. 🔧 Configure Knowledge Bases in Amazon Bedrock console"
echo "2. 📄 Upload health guidelines to S3 knowledge base bucket"
echo "3. 🧪 Test AI agents via API Gateway endpoints"
echo "4. 🌐 Update frontend environment variables"
echo ""
echo -e "${YELLOW}📚 Knowledge Base Setup:${NC}"
echo "• Health Guidelines: Upload CDC, WHO, medical reference documents"
echo "• Community Content: Health articles, research papers, wellness guides"
echo "• User Documents: Will be populated when users upload files"
echo ""
echo -e "${BLUE}🔗 Useful Commands:${NC}"
echo "• View stack outputs: aws cloudformation describe-stacks --stack-name EnablBackend-$ENVIRONMENT"
echo "• Check API Gateway: aws apigateway get-rest-apis"
echo "• Monitor Lambda logs: aws logs describe-log-groups --log-group-name-prefix /aws/lambda/EnablBackend"
