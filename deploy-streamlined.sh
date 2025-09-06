#!/bin/bash

# Enabl Health Infrastructure Deployment Script
# Deploys streamlined backend infrastructure based on updated copilot instructions
# 
# Usage:
#   ./deploy-streamlined.sh [environment]
#
# Environments: development, staging, production
# Default: development

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Default environment
ENVIRONMENT=${1:-development}

echo -e "${BLUE}🚀 Deploying Enabl Health Infrastructure${NC}"
echo -e "${BLUE}Environment: ${YELLOW}${ENVIRONMENT}${NC}"
echo -e "${BLUE}Date: $(date)${NC}"
echo ""

# Validate environment
if [[ ! "$ENVIRONMENT" =~ ^(development|staging|production)$ ]]; then
    echo -e "${RED}❌ Error: Invalid environment '${ENVIRONMENT}'${NC}"
    echo -e "${YELLOW}Valid environments: development, staging, production${NC}"
    exit 1
fi

# Check if AWS CLI is configured
if ! aws sts get-caller-identity &> /dev/null; then
    echo -e "${RED}❌ Error: AWS CLI not configured or no valid credentials${NC}"
    echo -e "${YELLOW}Please run 'aws configure' or set your AWS credentials${NC}"
    exit 1
fi

# Check if CDK is installed
if ! command -v cdk &> /dev/null; then
    echo -e "${RED}❌ Error: AWS CDK not installed${NC}"
    echo -e "${YELLOW}Please install CDK: npm install -g aws-cdk${NC}"
    exit 1
fi

# Install dependencies
echo -e "${BLUE}📦 Installing dependencies...${NC}"
npm install

# Build the project
echo -e "${BLUE}🔨 Building TypeScript...${NC}"
npm run build

# Bootstrap CDK (if needed)
echo -e "${BLUE}🥾 Bootstrapping CDK...${NC}"
cdk bootstrap --context environment=${ENVIRONMENT}

# Synthesize the stack
echo -e "${BLUE}📋 Synthesizing CloudFormation template...${NC}"
cdk synth --context environment=${ENVIRONMENT}

# Deploy confirmation
if [[ "$ENVIRONMENT" == "production" ]]; then
    echo -e "${YELLOW}⚠️  WARNING: You are about to deploy to PRODUCTION!${NC}"
    echo -e "${YELLOW}This will create/update production resources.${NC}"
    read -p "Are you sure you want to continue? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo -e "${YELLOW}❌ Deployment cancelled${NC}"
        exit 1
    fi
fi

# Deploy the stack
echo -e "${BLUE}🚀 Deploying infrastructure...${NC}"
echo -e "${YELLOW}Deploying all stacks for environment: ${ENVIRONMENT}${NC}"

cdk deploy \
    --context environment=${ENVIRONMENT} \
    --all \
    --require-approval never \
    --outputs-file ./outputs/${ENVIRONMENT}-outputs.json

# Check deployment status
if [ $? -eq 0 ]; then
    echo ""
    echo -e "${GREEN}✅ Deployment successful!${NC}"
    echo -e "${GREEN}Environment: ${ENVIRONMENT}${NC}"
    echo -e "${GREEN}Stack: EnablBackendStack-${ENVIRONMENT}${NC}"
    echo ""
    
    # Display key outputs
    echo -e "${BLUE}📋 Key Infrastructure Outputs:${NC}"
    echo -e "${YELLOW}Outputs saved to: ./outputs/${ENVIRONMENT}-outputs.json${NC}"
    
    if [ -f "./outputs/${ENVIRONMENT}-outputs.json" ]; then
        echo -e "${BLUE}Cognito User Pool ID:${NC} $(jq -r '.["EnablBackendStack-'${ENVIRONMENT}'"].UserPoolId // "Not found"' ./outputs/${ENVIRONMENT}-outputs.json)"
        echo -e "${BLUE}S3 Documents Bucket:${NC} $(jq -r '.["EnablBackendStack-'${ENVIRONMENT}'"].documentsBucketName // "Not found"' ./outputs/${ENVIRONMENT}-outputs.json)"
        echo -e "${BLUE}Knowledge Base ID:${NC} $(jq -r '.["EnablBackendStack-'${ENVIRONMENT}'"].KnowledgeBaseId // "Not found"' ./outputs/${ENVIRONMENT}-outputs.json)"
    fi
    
    echo ""
    echo -e "${GREEN}🎉 Enabl Health infrastructure deployed successfully!${NC}"
    echo -e "${YELLOW}Next steps:${NC}"
    echo -e "1. Update environment variables in App Runner"
    echo -e "2. Configure secrets in AWS Secrets Manager"
    echo -e "3. Upload knowledge base content to S3"
    echo -e "4. Test Bedrock agents functionality"
    
else
    echo ""
    echo -e "${RED}❌ Deployment failed!${NC}"
    echo -e "${YELLOW}Check the error messages above for details.${NC}"
    exit 1
fi
