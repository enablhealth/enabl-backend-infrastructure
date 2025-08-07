#!/bin/bash

# Build and push all AgentCore Docker images to ECR

set -e

# Configuration
AWS_REGION=${AWS_REGION:-us-east-1}
AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
ECR_REGISTRY="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"
DOCKER_DIR="./docker"

# Agents to build
AGENTS=("appointment-agent" "health-assistant" "community-agent" "document-agent")

echo "🚀 Building and pushing Enabl AgentCore images to ECR..."
echo "Registry: ${ECR_REGISTRY}"
echo "Region: ${AWS_REGION}"

# Login to ECR
echo "📝 Logging into ECR..."
aws ecr get-login-password --region ${AWS_REGION} | docker login --username AWS --password-stdin ${ECR_REGISTRY}

for AGENT in "${AGENTS[@]}"; do
    echo ""
    echo "🔨 Building ${AGENT}..."
    
    # Create ECR repository if it doesn't exist
    REPO_NAME="enabl-${AGENT}"
    echo "📦 Creating ECR repository: ${REPO_NAME}"
    aws ecr create-repository --repository-name ${REPO_NAME} --region ${AWS_REGION} 2>/dev/null || echo "Repository already exists"
    
    # Build Docker image
    echo "🐳 Building Docker image for ${AGENT}..."
    cd "${DOCKER_DIR}/${AGENT}"
    docker build --platform linux/arm64 -t "${REPO_NAME}:latest" .
    
    # Return to root directory
    cd - > /dev/null    # Tag for ECR
    docker tag ${REPO_NAME}:latest ${ECR_REGISTRY}/${REPO_NAME}:latest
    
    # Push to ECR
    echo "📤 Pushing ${REPO_NAME} to ECR..."
    docker push ${ECR_REGISTRY}/${REPO_NAME}:latest
    
    echo "✅ ${AGENT} pushed successfully!"
    echo "📋 Image URI: ${ECR_REGISTRY}/${REPO_NAME}:latest"
done

echo ""
echo "🎉 All AgentCore images built and pushed successfully!"
echo ""
echo "📋 Image URIs for Bedrock AgentCore:"
for AGENT in "${AGENTS[@]}"; do
    echo "  ${AGENT}: ${ECR_REGISTRY}/enabl-${AGENT}:latest"
done
echo ""
echo "💡 Use these URIs in the Bedrock AgentCore console"
