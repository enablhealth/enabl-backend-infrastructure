#!/bin/bash

# Deploy AWS Secrets Manager for Enabl Health
# This script deploys only the secrets for third-party credentials
# across all three environments (development, staging, production)

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🔐 Deploying AWS Secrets Manager for Enabl Health${NC}"
echo -e "${BLUE}This will create secrets for Google OAuth and Apple Sign-In${NC}"
echo -e "${BLUE}Date: $(date)${NC}"
echo ""

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

# Create outputs directory
mkdir -p ./outputs

# Install dependencies
echo -e "${BLUE}📦 Installing dependencies...${NC}"
npm install

# Build the project
echo -e "${BLUE}🔨 Building TypeScript...${NC}"
npm run build

# Bootstrap CDK (if needed)
echo -e "${BLUE}🥾 Bootstrapping CDK...${NC}"
cdk bootstrap

# Deploy to all environments
ENVIRONMENTS=("development" "staging" "production")

for ENV in "${ENVIRONMENTS[@]}"; do
    echo ""
    echo -e "${BLUE}🔐 Deploying secrets for ${YELLOW}${ENV}${BLUE} environment...${NC}"
    
    # Synthesize the stack
    echo -e "${BLUE}📋 Synthesizing CloudFormation template for ${ENV}...${NC}"
    cdk synth EnablSecretsStack-${ENV} --context environment=${ENV}
    
    # Deploy the secrets stack
    echo -e "${BLUE}🚀 Deploying secrets for ${ENV}...${NC}"
    cdk deploy EnablSecretsStack-${ENV} \
        --context environment=${ENV} \
        --require-approval never \
        --outputs-file ./outputs/${ENV}-secrets-outputs.json
    
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✅ Secrets deployed successfully for ${ENV}!${NC}"
    else
        echo -e "${RED}❌ Failed to deploy secrets for ${ENV}${NC}"
        exit 1
    fi
done

echo ""
echo -e "${GREEN}🎉 All secrets deployed successfully!${NC}"
echo ""
echo -e "${BLUE}📋 Secret Names Created:${NC}"
echo -e "${YELLOW}Development:${NC}"
echo -e "  • google-oauth-dev/client-secret"
echo -e "  • apple-signin-dev/credentials"
echo ""
echo -e "${YELLOW}Staging:${NC}"
echo -e "  • google-oauth-staging/client-secret"
echo -e "  • apple-signin-staging/credentials"
echo ""
echo -e "${YELLOW}Production:${NC}"
echo -e "  • google-oauth-prod/client-secret"
echo -e "  • apple-signin-prod/credentials"
echo ""
echo -e "${BLUE}📍 Next Steps:${NC}"
echo -e "1. Go to AWS Secrets Manager in the console"
echo -e "2. Update each secret with the correct values:"
echo ""
echo -e "${YELLOW}For Google OAuth secrets:${NC}"
echo -e '   {"clientId":"YOUR_CLIENT_ID","clientSecret":"YOUR_CLIENT_SECRET","environment":"ENV","callbackUrls":["..."]}'
echo ""
echo -e "${YELLOW}For Apple Sign-In secrets:${NC}"
echo -e '   {"teamId":"YOUR_TEAM_ID","keyId":"YOUR_KEY_ID","serviceId":"SERVICE_ID","privateKey":"YOUR_PRIVATE_KEY","environment":"ENV"}'
echo ""
echo -e "${BLUE}🔗 AWS Console Links:${NC}"
echo -e "Development: https://console.aws.amazon.com/secretsmanager/home?region=us-east-1#!/listSecrets/"
echo -e "Staging: https://console.aws.amazon.com/secretsmanager/home?region=us-east-1#!/listSecrets/"
echo -e "Production: https://console.aws.amazon.com/secretsmanager/home?region=us-east-1#!/listSecrets/"
echo ""
echo -e "${GREEN}🔐 Secrets Manager deployment complete!${NC}"
