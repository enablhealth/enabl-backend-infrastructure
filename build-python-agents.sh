#!/bin/bash

# Build and push Python AgentCore Docker images to ECR

set -e

# Configuration
AWS_REGION=${AWS_REGION:-us-east-1}
AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
ECR_REGISTRY="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"
DOCKER_DIR="./docker"

# Python Agents to build
PYTHON_AGENTS=("appointment-agent-python" "health-assistant-python" "community-agent-python")

echo "🚀 Building and pushing Enabl Python AgentCore images to ECR..."
echo "Registry: ${ECR_REGISTRY}"
echo "Region: ${AWS_REGION}"

# Login to ECR
echo "📝 Logging into ECR..."
aws ecr get-login-password --region ${AWS_REGION} | docker login --username AWS --password-stdin ${ECR_REGISTRY}

for AGENT in "${PYTHON_AGENTS[@]}"; do
    echo ""
    echo "🔨 Building ${AGENT}..."
    
    # Create ECR repository if it doesn't exist
    REPO_NAME="enabl-${AGENT}"
    echo "📦 Creating ECR repository: ${REPO_NAME}"
    aws ecr create-repository --repository-name ${REPO_NAME} --region ${AWS_REGION} 2>/dev/null || echo "Repository already exists"
    
    # Build Docker image
    echo "🐳 Building Docker image for ${AGENT}..."
    cd "${DOCKER_DIR}/${AGENT}"
    
    # Build with explicit platform for arm64 compatibility
    docker build --platform linux/arm64 -t "${REPO_NAME}:latest" .
    
    # Return to root directory
    cd - > /dev/null
    
    # Tag for ECR
    docker tag ${REPO_NAME}:latest ${ECR_REGISTRY}/${REPO_NAME}:latest
    
    # Push to ECR
    echo "📤 Pushing ${REPO_NAME} to ECR..."
    docker push ${ECR_REGISTRY}/${REPO_NAME}:latest
    
    echo "✅ ${AGENT} pushed successfully!"
    echo "📋 Image URI: ${ECR_REGISTRY}/${REPO_NAME}:latest"
done

echo ""
echo "🎉 All Python AgentCore images built and pushed successfully!"
echo ""
echo "Next steps:"
echo "1. Update agent runtime ARNs in agent_router.py to point to these Python agents"
echo "2. Deploy the updated Agent Router"
echo "3. Test the end-to-end Python-based AgentCore system"
