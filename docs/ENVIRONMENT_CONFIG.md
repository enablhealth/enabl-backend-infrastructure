# Environment Configuration for Enabl Health

## Overview
This file contains environment-specific configurations for the Enabl Health AWS infrastructure deployment.

## Environments

### Development (dev)
- **Domain**: https://dev.enabl.health
- **Google OAuth Client ID**: 842423158981-8ntg57v6hdb365nevu3d4ds9i2j7pooq.apps.googleusercontent.com
- **Purpose**: Development and testing
- **Data Retention**: 30 days
- **Auto-scaling**: Minimal capacity

### Staging (staging)
- **Domain**: https://staging.enabl.health
- **Google OAuth Client ID**: 842423158981-8ntg57v6hdb365nevu3d4ds9i2j7pooq.apps.googleusercontent.com
- **Purpose**: Pre-production testing and validation
- **Data Retention**: 90 days
- **Auto-scaling**: Medium capacity

### Production (prod)
- **Domain**: https://enabl.health
- **Google OAuth Client ID**: 965402584740-1j4t43ijt0rvlg2lq9hhaots5kg9v2tm.apps.googleusercontent.com
- **Purpose**: Live production environment
- **Data Retention**: 7 years
- **Auto-scaling**: Full capacity with burst

## AWS Resources

### Global Region Strategy
**Default Region: `us-east-1`**
- Optimized for global user access and low latency
- Contains the most comprehensive AWS service availability
- Cost-effective for global deployments
- Supports advanced features like CloudFront, Route 53, and Certificate Manager

### Cognito User Pool
- **Authentication Methods**: Email, Google OAuth, Apple OAuth (pending), Microsoft OAuth
- **Password Policy**: Minimum 8 characters, uppercase, lowercase, numbers, symbols
- **MFA**: Optional for dev/staging, required for production
- **Custom Attributes**: firstName, lastName, dateOfBirth, phoneNumber

### DynamoDB Tables
1. **Users**: User profiles and preferences
2. **Chats**: Chat history and conversations
3. **Documents**: Document metadata and references
4. **Appointments**: Calendar and appointment data
5. **Integrations**: Third-party service connections

### S3 Buckets
1. **Documents**: User-uploaded documents and files
2. **Uploads**: Temporary upload storage with lifecycle policies
3. **Backups**: Database backups and system snapshots

### API Gateway
- **Authorization**: Cognito User Pool authorizer
- **CORS**: Enabled for web application domains
- **Rate Limiting**: Environment-specific throttling
- **Monitoring**: CloudWatch integration

## Security Configuration

### IAM Roles
- **Lambda Execution Role**: Basic execution with VPC access
- **Cognito Identity Pool**: Authenticated and unauthenticated roles
- **S3 Access**: Least privilege access patterns

### VPC (Optional)
- **Private Subnets**: Database and Lambda functions
- **Public Subnets**: NAT Gateways and load balancers
- **Security Groups**: Restrictive inbound rules

## Deployment Process

### Prerequisites
1. AWS CLI configured with appropriate permissions
2. AWS CDK v2.95.0 or later
3. Node.js 18+ with npm
4. Valid AWS account with sufficient quota

### Steps
1. **Bootstrap CDK**: `./scripts/deploy.sh bootstrap`
2. **Deploy Development**: `./scripts/deploy.sh deploy dev`
3. **Deploy Staging**: `./scripts/deploy.sh deploy staging`
4. **Deploy Production**: `./scripts/deploy.sh deploy prod`

### Validation
- Check CloudFormation stacks in AWS Console
- Verify Cognito User Pool configuration
- Test API Gateway endpoints
- Validate S3 bucket policies

## Environment Variables

### Required for Frontend Integration
```bash
# All Environments use us-east-1 for global users
NEXT_PUBLIC_AWS_REGION=us-east-1

# Development
NEXT_PUBLIC_USER_POOL_ID=[Output from CDK]
NEXT_PUBLIC_USER_POOL_WEB_CLIENT_ID=[Output from CDK]
NEXT_PUBLIC_IDENTITY_POOL_ID=[Output from CDK]
NEXT_PUBLIC_API_GATEWAY_URL=[Output from CDK]
NEXT_PUBLIC_GOOGLE_CLIENT_ID=842423158981-8ntg57v6hdb365nevu3d4ds9i2j7pooq.apps.googleusercontent.com

# Production
NEXT_PUBLIC_USER_POOL_ID=[Output from CDK]
NEXT_PUBLIC_USER_POOL_WEB_CLIENT_ID=[Output from CDK]
NEXT_PUBLIC_IDENTITY_POOL_ID=[Output from CDK]
NEXT_PUBLIC_API_GATEWAY_URL=[Output from CDK]
NEXT_PUBLIC_GOOGLE_CLIENT_ID=965402584740-1j4t43ijt0rvlg2lq9hhaots5kg9v2tm.apps.googleusercontent.com
```

## Monitoring and Alerting

### CloudWatch Metrics
- API Gateway request counts and error rates
- DynamoDB read/write capacity utilization
- S3 bucket size and request metrics
- Cognito authentication success/failure rates

### Alarms
- High error rates (>5% for 5 minutes)
- DynamoDB throttling events
- S3 storage costs exceeding budget
- Unusual authentication patterns

## Backup and Recovery

### Automated Backups
- DynamoDB: Point-in-time recovery enabled
- S3: Cross-region replication for production
- CloudFormation: Template versioning

### Recovery Procedures
1. **Data Recovery**: Restore from DynamoDB backups
2. **Infrastructure Recovery**: Redeploy from CDK templates
3. **User Data**: Recover from S3 backup buckets

## Cost Optimization

### Development Environment
- Use DynamoDB on-demand billing
- Minimal S3 storage classes
- Basic CloudWatch monitoring

### Production Environment
- Reserved capacity for predictable workloads
- S3 Intelligent Tiering
- Enhanced monitoring and alerting

## Compliance and Security

### Data Protection
- Encryption at rest for all storage
- Encryption in transit for all communications
- Regular security audits and updates

### Access Control
- Principle of least privilege
- Regular access reviews
- Multi-factor authentication for admin access

### Audit Logging
- CloudTrail for all API calls
- VPC Flow Logs for network traffic
- Application-level audit logs

## Troubleshooting

### Common Issues
1. **CDK Bootstrap**: Ensure AWS credentials have sufficient permissions
2. **Domain Configuration**: Verify Route 53 hosted zones
3. **OAuth Configuration**: Check Google/Apple OAuth redirect URIs
4. **CORS Issues**: Validate API Gateway CORS settings

### Debug Commands
```bash
# Check CDK diff
./scripts/deploy.sh diff dev

# View stack outputs
./scripts/deploy.sh outputs dev

# Check CloudFormation events
aws cloudformation describe-stack-events --stack-name EnablBackend-dev

# Test Cognito configuration
aws cognito-idp list-user-pools --max-items 10
```

## Support Contacts

### Development Team
- **Infrastructure**: AWS CDK and CloudFormation
- **Frontend**: Next.js and React integration
- **Authentication**: Cognito and OAuth configuration

### AWS Support
- **Account ID**: [Account-specific]
- **Support Plan**: [Plan-specific]
- **Primary Region**: us-east-1
