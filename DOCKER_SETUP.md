# Quick AgentCore Docker Setup Guide

⚠️ **Important**: Bedrock AgentCore only supports ARM64 architecture. All containers must be built for `linux/arm64`.

## 🐳 **Step 1: Build and Push Docker Images**

Run this single command to build and push all agent images to ECR:

```bash
cd /Users/kenriquezm4pro/Documents/_MVP/enablhealth-ai/enabl-backend-infrastructure
./build-agents.sh
```

This will:
✅ Create ECR repositories for each agent
✅ Build Docker images with your Lambda code for ARM64 architecture
✅ Push to ECR with proper tagging
✅ Display the Image URIs you need

## 🎯 **Step 2: Use Image URIs in Bedrock Console**

After running the build script, you'll get Image URIs like:
```
123456789012.dkr.ecr.us-east-1.amazonaws.com/enabl-appointment-agent:latest
123456789012.dkr.ecr.us-east-1.amazonaws.com/enabl-health-assistant:latest
123456789012.dkr.ecr.us-east-1.amazonaws.com/enabl-community-agent:latest
123456789012.dkr.ecr.us-east-1.amazonaws.com/enabl-document-agent:latest
```

## 🔧 **Step 3: Create Agents in Bedrock Console**

For each agent:

1. **Go to Bedrock Console** → Agents → Create Agent
2. **Choose "Host agent"**
3. **Enter the Image URI** from step 2
4. **IAM Permissions**: Choose **"Create and use a new service role"**
5. **Configure agent instructions** (see BEDROCK_AGENT_SETUP.md)

## 🚀 **Step 4: Update Environment Variables**

After creating agents, update your Lambda environment variables:

```bash
# Get these from the Bedrock console after creating agents
BEDROCK_APPOINTMENT_AGENT_ID=your-appointment-agent-id
BEDROCK_HEALTH_AGENT_ID=your-health-agent-id
BEDROCK_COMMUNITY_AGENT_ID=your-community-agent-id
BEDROCK_DOCUMENT_AGENT_ID=your-document-agent-id
```

## ⚠️ **Important Notes:**

- **Platform**: Images are built for `linux/amd64` for compatibility
- **Dependencies**: All AWS SDK dependencies are included
- **Lambda Runtime**: Uses AWS Lambda Node.js 18 runtime
- **Size**: Images are optimized for Lambda deployment

## 🔄 **To Update Agents:**

1. Modify your Lambda code
2. Run `./build-agents.sh` again
3. Images will be updated automatically
4. Bedrock will use the new `:latest` tag

## 💡 **Cost Optimization:**

- ECR storage costs are minimal for these small images
- AgentCore charges per invocation, not per container
- Images are only pulled when agents are invoked
