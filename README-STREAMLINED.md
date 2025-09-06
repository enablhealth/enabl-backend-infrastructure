# Enabl Health Backend Infrastructure - Streamlined Version

## Overview
This streamlined backend infrastructure is aligned with the updated copilot instructions and focuses on essential services for the Enabl Health AI-powered healthcare platform.

## Architecture Changes

### ✅ **Services Included (Essential)**
- **Amazon Cognito** - User authentication with environment-specific user pools
- **Amazon DynamoDB** - Data storage (users, chats, documents)
- **Amazon S3** - Document and knowledge base storage
- **Amazon Bedrock** - AI agents with Amazon foundation models
- **AWS Secrets Manager** - Secure third-party credential storage
- **OpenSearch Serverless** - Vector database for knowledge base

### ❌ **Services Removed (Simplified)**
- **API Gateway** - Replaced by Next.js API routes
- **Lambda Functions** - Replaced by Next.js serverless functions
- **Custom Domain/CDN** - Handled by App Runner + CloudFront
- **Complex Networking** - Simplified for Next.js + App Runner architecture

## Amazon Foundation Model Strategy

### Environment-Specific Models
```yaml
Development (Cost-Optimized):
  Health Assistant: amazon.titan-text-express-v1
  Community Agent: amazon.titan-text-lite-v1
  Appointment Agent: amazon.nova-micro-v1:0
  Document Agent: amazon.titan-text-express-v1

Staging (Production-Identical):
  Health Assistant: amazon.nova-pro-v1:0
  Community Agent: amazon.titan-text-express-v1
  Appointment Agent: amazon.nova-lite-v1:0
  Document Agent: amazon.titan-text-express-v1

Production (Maximum Performance):
  Health Assistant: amazon.nova-pro-v1:0
  Community Agent: amazon.titan-text-express-v1
  Appointment Agent: amazon.nova-lite-v1:0
  Document Agent: amazon.titan-text-express-v1
```

### Future Model Expansion
- **Phase 1**: Amazon models (current implementation) ✅
- **Phase 2**: User preference settings for model selection
- **Phase 3**: Optional Anthropic Claude integration
- **Phase 4**: Multi-vendor model marketplace

## Three-Tier Environment Strategy

### Development Environment
- **Purpose**: Rapid development and testing
- **Resources**: Minimal provisioning for cost efficiency
- **Models**: Smaller, faster Amazon models
- **Data**: Synthetic test data only

### Staging Environment  
- **Purpose**: Production-like testing and validation
- **Resources**: Production-scale provisioning
- **Models**: Identical to production models
- **Data**: Realistic test data (anonymized)

### Production Environment
- **Purpose**: Real user interactions
- **Resources**: Full-scale with auto-scaling
- **Models**: Premium Amazon models with guardrails
- **Data**: Real encrypted user data

## Deployment

### Quick Start
```bash
# Install dependencies
npm install

# Deploy to development
./deploy-streamlined.sh development

# Deploy to staging
./deploy-streamlined.sh staging

# Deploy to production (manual confirmation required)
./deploy-streamlined.sh production
```

### Environment Configuration
Each environment has dedicated:
- Cognito User Pools (complete user isolation)
- DynamoDB Tables (environment-specific naming)
- S3 Buckets (separate storage per environment)
- Bedrock Agents (isolated AI agents)
- Secrets Manager (environment-specific credentials)

## Security & Compliance

### HIPAA Compliance
- **Encryption**: All data encrypted at rest and in transit
- **Access Control**: IAM roles with minimal permissions
- **Audit Trails**: CloudTrail enabled for staging/production
- **Data Isolation**: Complete environment separation

### Third-Party Integration Security
- **Google OAuth**: Environment-specific client IDs and secrets
- **Apple Sign-In**: Dedicated service IDs per environment
- **Secrets Storage**: AWS Secrets Manager with rotation support

## Cost Optimization

### Development
- PAY_PER_REQUEST DynamoDB billing
- Smaller Amazon Bedrock models
- Minimal S3 storage classes
- No point-in-time recovery

### Staging
- Provisioned DynamoDB (production-like)
- Production-identical models
- Standard S3 storage
- Point-in-time recovery enabled

### Production
- Auto-scaling DynamoDB
- Premium Amazon models
- Intelligent S3 tiering
- Full backup and recovery

## Integration with Next.js App

### Environment Variables
The infrastructure outputs the following values for Next.js:
```bash
COGNITO_USER_POOL_ID
COGNITO_USER_POOL_CLIENT_ID
DYNAMODB_USER_TABLE
DYNAMODB_CHAT_TABLE
DYNAMODB_DOCUMENTS_TABLE
S3_DOCUMENTS_BUCKET
S3_KNOWLEDGE_BASE_BUCKET
BEDROCK_HEALTH_ASSISTANT_ID
BEDROCK_COMMUNITY_AGENT_ID
BEDROCK_APPOINTMENT_AGENT_ID
BEDROCK_DOCUMENT_AGENT_ID
KNOWLEDGE_BASE_ID
```

### Secrets Manager Integration
Third-party credentials are accessed via:
```typescript
// Google OAuth
const googleSecret = await secretsManager
  .getSecretValue({ SecretId: 'google-oauth-{env}/client-secret' })
  .promise();

// Apple Sign-In  
const appleSecret = await secretsManager
  .getSecretValue({ SecretId: 'apple-signin-{env}/credentials' })
  .promise();
```

## Monitoring & Observability

### CloudWatch Integration
- **Logs**: Centralized logging for all services
- **Metrics**: Custom metrics for AI agent performance
- **Alarms**: Automated alerts for service health

### HIPAA Audit Requirements
- **CloudTrail**: API call logging (staging/production)
- **Access Logs**: S3 and DynamoDB access tracking
- **Encryption**: All services use AWS-managed encryption

## Next Steps

### Immediate Tasks
1. **Deploy Development Environment**: Test core functionality
2. **Configure Secrets**: Add Google/Apple credentials to Secrets Manager
3. **Upload Knowledge Base**: Add medical guidelines to S3
4. **Test Bedrock Agents**: Validate AI functionality

### Future Enhancements
1. **Model Expansion**: Add user-selectable foundation models
2. **Global Scaling**: Multi-region deployment
3. **Advanced Monitoring**: Custom dashboards and alerting
4. **Compliance**: SOC 2 and additional healthcare certifications

## Support

For questions or issues with the infrastructure:
1. Check CloudFormation stack events in AWS Console
2. Review CDK deployment logs
3. Validate environment-specific configurations
4. Test individual service functionality

This streamlined architecture provides enterprise-grade infrastructure while maintaining simplicity and cost efficiency for the Enabl Health platform.
