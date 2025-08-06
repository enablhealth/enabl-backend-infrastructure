# Enabl Health AWS Setup Guide

## Quick Start for Global Users

Enabl Health is optimized for global users with `us-east-1` as the default AWS region for optimal performance and service availability.

### Prerequisites

1. **AWS Account** with administrative permissions
2. **AWS CLI** configured with credentials
3. **Node.js 18+** with npm
4. **AWS CDK v2.95.0+** installed globally

### Initial Setup

1. **Configure AWS CLI for Global Users**
   ```bash
   aws configure
   # When prompted for region, use: us-east-1
   # This ensures optimal global performance
   ```

2. **Install CDK (if not already installed)**
   ```bash
   npm install -g aws-cdk@latest
   ```

3. **Navigate to Infrastructure Directory**
   ```bash
   cd enabl-backend-infrastructure
   ```

4. **Install Dependencies**
   ```bash
   npm install
   ```

### Deployment Commands

#### 1. Bootstrap CDK (One-time setup)
```bash
./scripts/deploy.sh bootstrap
```
This automatically uses `us-east-1` for global optimization.

#### 2. Deploy Development Environment
```bash
./scripts/deploy.sh deploy dev
```

#### 3. Deploy Staging Environment
```bash
./scripts/deploy.sh deploy staging
```

#### 4. Deploy Production Environment
```bash
./scripts/deploy.sh deploy prod
```

### Regional Strategy

**Why us-east-1?**
- ✅ **Global Performance**: Lowest latency for most international users
- ✅ **Service Availability**: Access to all AWS services and latest features
- ✅ **Cost Optimization**: Most cost-effective region for global deployments
- ✅ **Compliance**: Supports all major compliance frameworks
- ✅ **CDN Integration**: Optimal CloudFront performance worldwide

### Environment URLs

| Environment | URL | Purpose |
|-------------|-----|---------|
| Development | https://dev.enabl.health | Development and testing |
| Staging | https://staging.enabl.health | Pre-production validation |
| Production | https://enabl.health | Live application |

### Post-Deployment

After successful deployment, you'll receive outputs including:
- Cognito User Pool ID
- API Gateway URL
- S3 Bucket names
- CloudFront distribution URLs

These outputs should be configured in your Next.js frontend environment variables.

### Monitoring Global Performance

Monitor your global users with:
- CloudWatch metrics in `us-east-1`
- CloudFront analytics for worldwide performance
- API Gateway logs for request patterns
- Cognito analytics for authentication trends

### Support

For deployment issues:
1. Check CloudFormation stack events in AWS Console
2. Review CDK deployment logs
3. Validate AWS credentials and permissions
4. Ensure `us-east-1` region access

### Advanced Configuration

For enterprise users requiring multi-region deployment:
1. Update `config.ts` with additional regions
2. Modify CDK stack for cross-region replication
3. Configure Route 53 for global DNS routing
4. Set up cross-region backup strategies

---

**Note**: All Enabl Health infrastructure is optimized for global users with `us-east-1` as the primary region. This configuration provides the best balance of performance, cost, and feature availability for worldwide deployment.
