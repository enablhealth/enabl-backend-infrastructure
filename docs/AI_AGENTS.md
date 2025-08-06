# Enabl Health AI Agents

This directory contains the implementation of Enabl Health's AI agents using Amazon Bedrock with RAG (Retrieval-Augmented Generation) capabilities.

## 🤖 AI Agents Overview

### 1. Health Assistant Agent
- **Purpose**: Primary health guidance and medical information
- **Model**: Claude 3 Sonnet (Anthropic)
- **Knowledge Base**: Health guidelines, medical references, CDC/WHO content
- **Features**: Personalized health advice, medication reminders, symptom guidance

### 2. Community Agent  
- **Purpose**: Health content curation and community resources
- **Model**: Titan Text Express (Amazon)
- **Knowledge Base**: Health articles, research papers, community content
- **Features**: Article recommendations, research summaries, trend analysis

### 3. Document Agent
- **Purpose**: Medical document analysis and interpretation
- **Model**: Command Text (Cohere)
- **Knowledge Base**: User-uploaded documents, medical terminology
- **Features**: Lab result interpretation, document summarization, terminology explanation

## 🏗️ Architecture

```
Frontend → API Gateway → Chat Router → Specific Agent → Bedrock → Knowledge Base
                                    ↓
                               Lambda Function → S3 Documents
```

### Components:
- **Chat Router**: Intelligent request routing based on intent analysis
- **Knowledge Bases**: Vector databases with embedded health content
- **API Gateway**: Secure endpoints with Cognito authorization
- **S3 Buckets**: Document storage for RAG processing

## 🚀 Deployment

### Prerequisites
```bash
# Install dependencies
npm install

# Bootstrap CDK (first time only)
cdk bootstrap

# Deploy AI agents infrastructure
./scripts/deploy-ai-agents.sh dev
```

### Environment Variables
After deployment, configure these in your frontend:

```env
NEXT_PUBLIC_AI_API_URL=https://your-api-gateway-url
NEXT_PUBLIC_AWS_REGION=us-east-1
```

## 📚 Knowledge Base Setup

### 1. Health Guidelines Knowledge Base
Upload to S3 bucket `enabl-knowledge-base-{env}`:
```
health-guidelines/
├── cdc-guidelines/
├── who-recommendations/
├── medical-references/
└── drug-interactions/
```

### 2. Community Content Knowledge Base
```
community-content/
├── research-papers/
├── health-articles/
├── wellness-guides/
└── trending-topics/
```

### 3. User Documents Knowledge Base
Automatically populated when users upload:
- Medical reports
- Lab results
- Prescription information
- Health tracking data

## 🔐 Security & Compliance

### HIPAA Compliance
- ✅ Amazon Bedrock is HIPAA eligible
- ✅ Encryption in transit and at rest
- ✅ Audit logging with CloudTrail
- ✅ IAM least-privilege access
- ✅ VPC isolation for sensitive data

### Data Protection
- PHI is encrypted using AWS KMS
- Access controlled via Cognito authentication
- API rate limiting and throttling
- Comprehensive audit trails

## 🧪 Testing AI Agents

### 1. Health Assistant
```bash
curl -X POST https://your-api-url/agents/health \
  -H "Authorization: Bearer your-cognito-token" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "I have a headache and fever. What should I do?",
    "userId": "user123",
    "context": "Patient has no known allergies"
  }'
```

### 2. Community Agent
```bash
curl -X POST https://your-api-url/agents/community \
  -H "Authorization: Bearer your-cognito-token" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "Find recent research on diabetes management",
    "userId": "user123"
  }'
```

### 3. Document Agent
```bash
curl -X POST https://your-api-url/agents/documents \
  -H "Authorization: Bearer your-cognito-token" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "Explain my cholesterol levels",
    "userId": "user123",
    "documentId": "lab-report-123"
  }'
```

## 📊 Monitoring & Analytics

### CloudWatch Dashboards
- Agent response times and success rates
- Knowledge base query performance  
- User interaction patterns
- Error rates and debugging info

### Key Metrics
- Average response time per agent
- Knowledge base retrieval accuracy
- User satisfaction scores
- API usage patterns

## 💰 Cost Optimization

### Bedrock Pricing (Estimated)
- **Claude 3 Sonnet**: ~$3 per 1M input tokens
- **Titan Text**: ~$0.50 per 1M tokens  
- **Knowledge Base**: $0.10 per GB/month

### Optimization Strategies
- Cache frequent queries
- Use appropriate models per agent
- Implement request batching
- Monitor token usage

## 🔧 Troubleshooting

### Common Issues

1. **Knowledge Base Not Found**
   ```bash
   # Check if knowledge base exists
   aws bedrock list-knowledge-bases --region us-east-1
   ```

2. **Model Access Denied**
   ```bash
   # Request model access in Bedrock console
   aws bedrock list-foundation-models --region us-east-1
   ```

3. **Lambda Timeout**
   - Increase timeout in CDK stack
   - Optimize knowledge base queries
   - Add response caching

### Debug Commands
```bash
# Check Lambda logs
aws logs tail /aws/lambda/EnablBackend-dev-HealthAssistantFunction --follow

# Test API Gateway
aws apigateway test-invoke-method --rest-api-id YOUR_API_ID --resource-id YOUR_RESOURCE_ID --http-method POST

# Monitor Bedrock usage
aws bedrock get-model-invocation-logging-configuration --region us-east-1
```

## 🚀 Future Enhancements

### Phase 2 Features
- Multi-modal capabilities (image, voice)
- Real-time streaming responses
- Advanced conversation memory
- Appointment scheduling integration

### Phase 3 Features  
- Custom fine-tuned models
- Multi-language support
- Integration with wearable devices
- Predictive health analytics

## 📖 API Reference

### Chat Router Endpoint
**POST** `/chat`
```json
{
  "message": "string",
  "userId": "string", 
  "agentType": "health-assistant|community-agent|document-agent",
  "sessionId": "string",
  "context": "string"
}
```

### Response Format
```json
{
  "response": "string",
  "agentType": "string",
  "sessionId": "string", 
  "citations": ["string"],
  "timestamp": "string",
  "routedTo": "string",
  "routingDecision": "explicit|inferred"
}
```

---

**Enabl Health AI Agents** - Powered by Amazon Bedrock 🤖💊
