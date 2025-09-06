# Infrastructure Reconciliation Plan

## Problem Summary
The unified stack approach created duplicate resources instead of integrating with existing infrastructure:

### Existing Infrastructure (Original Naming)
- **Environment Names**: dev, staging, prod
- **CloudFormation Stacks**: 
  - `enabl-backend-development` (with multi-stack dependencies)
  - `enabl-backend-staging`
  - `enabl-backend-production`
- **Cognito User Pools**:
  - `enabl-users-dev` (us-east-1_lBBFpwOnU) ✅ WORKING
  - `enabl-users-staging` (us-east-1_ex9P9pFRA) ✅ WORKING  
  - `enabl-users-prod` (us-east-1_fUHVuOW4f) ✅ WORKING
- **S3 Buckets**:
  - `enabl-documents-dev` ✅ WORKING
  - `enabl-documents-staging` ✅ WORKING
  - `enabl-documents-prod` ✅ WORKING

### Duplicate Resources Created (Unified Stack)
- **CloudFormation Stack**: `EnablHealthStack-development`
- **Cognito User Pools**: 
  - `enabl-users-development` (us-east-1_RXZOHayAl) ❌ DUPLICATE
  - `enabl-users-development` (us-east-1_RnsJIwVWb) ❌ DUPLICATE
- **S3 Buckets**:
  - `enabl-documents-development-775525057465` ❌ DUPLICATE
  - `enabl-knowledge-base-development-775525057465` ❌ DUPLICATE

## Resolution Options

### Option 1: Import Existing Resources (RECOMMENDED)
**Approach**: Modify unified stack to import existing resources instead of creating new ones
**Benefits**: 
- Maintains existing user data and configurations
- No disruption to current frontend/backend integrations
- Preserves established naming conventions

**Steps**:
1. Update unified stack to use original naming convention (dev/staging/prod)
2. Use CDK import functionality to adopt existing resources
3. Remove duplicate resources created by unified stack
4. Deploy unified stack with imported resources

### Option 2: Migrate to New Resources
**Approach**: Migrate data from existing resources to new unified stack resources
**Benefits**: 
- Clean slate with consistent naming
- Unified infrastructure from the start

**Risks**: 
- Complex data migration process
- Potential data loss
- Downtime during migration
- Need to update all frontend environment variables

### Option 3: Hybrid Approach
**Approach**: Keep existing resources for environments with user data, use unified for new environments
**Benefits**: 
- No risk to existing user data
- Can test unified approach on development first

## Recommended Implementation Plan

### Phase 1: Cleanup Duplicates (IMMEDIATE)
```bash
# Delete duplicate unified stack
aws cloudformation delete-stack --stack-name EnablHealthStack-development

# Delete duplicate Cognito pools
aws cognito-idp delete-user-pool --user-pool-id us-east-1_RXZOHayAl
aws cognito-idp delete-user-pool --user-pool-id us-east-1_RnsJIwVWb

# Delete duplicate S3 buckets (after ensuring they're empty)
aws s3 rb s3://enabl-documents-development-775525057465 --force
aws s3 rb s3://enabl-knowledge-base-development-775525057465 --force
```

### Phase 2: Update Unified Stack for Import (NEXT)
1. Modify `enabl-unified-stack.ts` to use original naming convention:
   - `development` → `dev`
   - `staging` → `staging` (already correct)
   - `production` → `prod`

2. Update resource names to match existing:
   - `enabl-users-${environment}` → Use existing IDs
   - `enabl-documents-${environment}` → Use existing bucket names

3. Use CDK import to adopt existing resources

### Phase 3: Gradual Migration (FUTURE)
1. Test unified stack with development environment first
2. Once validated, migrate staging
3. Finally migrate production with careful coordination

## Immediate Action Required

**STOP**: Do not create any new resources
**INVENTORY**: Complete mapping of all existing resources
**IMPORT**: Use CDK import functionality to adopt existing infrastructure
**STANDARDIZE**: Align on single naming convention across all environments

## Resource Mapping for Import

### DynamoDB Tables (Existing)
```bash
# Check existing tables
aws dynamodb list-tables | grep enabl
```

### S3 Buckets (Existing) 
- `enabl-documents-dev`
- `enabl-documents-staging` 
- `enabl-documents-prod`
- `enabl-knowledge-base-dev` (if exists)
- `enabl-knowledge-base-staging`
- `enabl-knowledge-base-production`

### Cognito User Pools (Existing)
- Dev: `enabl-users-dev` (us-east-1_lBBFpwOnU)
- Staging: `enabl-users-staging` (us-east-1_ex9P9pFRA)
- Production: `enabl-users-prod` (us-east-1_fUHVuOW4f)

## Next Steps
1. ✅ **COMPLETED**: Inventory existing resources
2. 🔄 **IN PROGRESS**: Present reconciliation options to user
3. ⏳ **PENDING**: User decision on approach
4. ⏳ **PENDING**: Implement chosen reconciliation strategy
