# Enabl Health Backend Infrastructure

AWS CDK infrastructure for Enabl Health - Your AI-powered everyday health assistant.

## 🏗️ Architecture Overview

This CDK project creates and manages all backend AWS resources for Enabl Health:

### Core Services
- **Amazon Cognito**: User authentication with social sign-in (Google, Apple)
- **Amazon DynamoDB**: NoSQL database for user data, chats, documents, and appointments
- **Amazon S3**: Object storage for documents and user uploads
- **API Gateway**: REST API endpoints with Cognito authentication
- **AWS Lambda**: Serverless business logic functions
- **CloudFront**: Content delivery network for global performance

### Security & Compliance
- End-to-end encryption for sensitive health data
- HIPAA-compliant infrastructure configuration
- IAM roles with least-privilege access
- VPC isolation for sensitive resources

## 🚀 Quick Start

### Prerequisites
- AWS CLI configured with appropriate permissions
- Node.js 18+ and npm
- AWS CDK CLI installed globally: `npm install -g aws-cdk`

### Installation

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Bootstrap CDK (first time only)**
   ```bash
   npm run bootstrap
   ```

3. **Deploy to development environment**
   ```bash
   npm run deploy:dev
   ```

### Environment-Specific Deployments

```bash
# Development environment
npm run deploy:dev

# Staging environment
npm run deploy:staging

# Production environment
npm run deploy:prod
```

## 📁 Project Structure

```
enabl-backend-infrastructure/
├── bin/
│   └── enabl-backend-infrastructure.ts  # CDK app entry point
├── lib/
│   ├── config.ts                        # Environment configurations
│   ├── enabl-backend-stack.ts          # Main infrastructure stack
│   ├── constructs/                      # Reusable CDK constructs
│   └── lambda/                          # Lambda function code
├── test/                                # Unit tests
├── cdk.json                            # CDK configuration
├── package.json                        # Dependencies and scripts
└── README.md                           # This file
```

## ⚙️ Configuration

Environment-specific configurations are defined in `lib/config.ts`:

### Development Environment
- **Domain**: `dev.enabl.health`
- **Database**: Pay-per-request DynamoDB tables
- **Storage**: S3 buckets with CORS for local development
- **Auth**: Google OAuth (dev client ID)

### Staging Environment
- **Domain**: `staging.enabl.health`
- **Database**: Production-like DynamoDB setup
- **Storage**: Restricted CORS origins
- **Auth**: Google OAuth (dev client ID)

### Production Environment
- **Domain**: `enabl.health`
- **Database**: High-availability DynamoDB tables
- **Storage**: Production S3 buckets with backups
- **Auth**: Google OAuth (prod client ID)

## 🔐 Authentication Setup

### Cognito Configuration
- **User Pool**: Email and phone number sign-in
- **Social Providers**: Google OAuth integration
- **Custom Attributes**: `isGuest`, `isPremium`, `preferences`
- **Password Policy**: Strong passwords with complexity requirements

### Google OAuth Setup
1. Configure OAuth consent screen in Google Cloud Console
2. Create OAuth 2.0 client ID
3. Add authorized domains and redirect URIs
4. Update client IDs in `lib/config.ts`

### Environment Variables for Frontend
After deployment, use these outputs in your Next.js app:

```bash
# Development
NEXT_PUBLIC_AWS_REGION=us-east-1
NEXT_PUBLIC_USER_POOL_ID=<UserPoolId>
NEXT_PUBLIC_USER_POOL_CLIENT_ID=<UserPoolClientId>
NEXT_PUBLIC_IDENTITY_POOL_ID=<IdentityPoolId>
NEXT_PUBLIC_API_URL=<ApiUrl>
```

## 📊 Database Schema

### Users Table
```json
{
  "userId": "string (PK)",
  "email": "string",
  "name": "string",
  "isGuest": "boolean",
  "isPremium": "boolean",
  "preferences": "object",
  "createdAt": "timestamp",
  "updatedAt": "timestamp"
}
```

### Chats Table
```json
{
  "userId": "string (PK)",
  "chatId": "string (SK)",
  "title": "string",
  "messages": "array",
  "agentType": "string",
  "modelUsed": "string",
  "createdAt": "timestamp",
  "updatedAt": "timestamp"
}
```

### Documents Table
```json
{
  "userId": "string (PK)",
  "documentId": "string (SK)",
  "fileName": "string",
  "fileType": "string",
  "fileSize": "number",
  "s3Key": "string",
  "metadata": "object",
  "createdAt": "timestamp"
}
```

## 🛡️ Security Best Practices

### Data Protection
- All data encrypted at rest and in transit
- S3 buckets with versioning and lifecycle policies
- DynamoDB point-in-time recovery enabled
- IAM roles with minimal required permissions

### Network Security
- API Gateway with rate limiting and throttling
- CORS configured for allowed origins only
- CloudFront with security headers
- WAF rules for API protection (production)

### Monitoring & Logging
- CloudWatch logs for all services
- X-Ray tracing enabled
- Detailed metrics and alarms
- Audit trail for all user actions

## 🚀 Deployment Process

### CI/CD Pipeline
The infrastructure follows a GitOps approach:

1. **Development**: Automatic deployment on merge to `develop`
2. **Staging**: Manual promotion from development
3. **Production**: Manual deployment with approval process

### Zero-Downtime Deployments
- Blue-green deployments for API Gateway
- Rolling updates for Lambda functions
- Database migrations with backwards compatibility
- CloudFront invalidation strategies

## 📈 Monitoring & Observability

### CloudWatch Dashboards
- API performance metrics
- Database performance and costs
- User authentication patterns
- Error rates and latencies

### Alarms & Notifications
- High error rates
- Unusual authentication patterns
- Database throttling
- Storage quota warnings

## 🔧 Troubleshooting

### Common Issues

1. **Bootstrap Error**
   ```bash
   # Solution: Ensure AWS credentials are configured
   aws configure list
   cdk bootstrap aws://ACCOUNT-NUMBER/REGION
   ```

2. **Deployment Timeout**
   ```bash
   # Solution: Check CloudFormation events
   aws cloudformation describe-stack-events --stack-name EnablBackend-development
   ```

3. **Permission Denied**
   ```bash
   # Solution: Verify IAM permissions
   aws sts get-caller-identity
   ```

### Useful Commands

```bash
# View current deployment status
npm run diff

# Synthesize CloudFormation template
npm run synth

# Destroy stack (careful!)
npm run destroy

# View all stacks
cdk list

# View stack outputs
aws cloudformation describe-stacks --stack-name EnablBackend-development --query "Stacks[0].Outputs"
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/your-feature`
3. Make changes and test locally
4. Run linting: `npm run lint:fix`
5. Run tests: `npm test`
6. Submit a pull request

## 📚 Additional Resources

- [AWS CDK Documentation](https://docs.aws.amazon.com/cdk/)
- [Amazon Cognito Developer Guide](https://docs.aws.amazon.com/cognito/)
- [DynamoDB Best Practices](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/best-practices.html)
- [API Gateway Security](https://docs.aws.amazon.com/apigateway/latest/developerguide/security.html)

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🆘 Support

For infrastructure support, please:
1. Check this README and troubleshooting section
2. Review CloudWatch logs and metrics
3. Contact the DevOps team via Slack #enabl-infrastructure
4. Create an issue in this repository for bugs or feature requests

---

**Enabl Health** - Empowering everyday health with AI 🏥🤖
