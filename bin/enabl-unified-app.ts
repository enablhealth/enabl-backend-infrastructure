#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { EnablUnifiedStack } from '../lib/enabl-unified-stack-import';
import { EnablConfig, getConfig } from '../lib/config';

const app = new cdk.App();

// Load configuration
const config = getConfig();

// Development environment - import existing resources
new EnablUnifiedStack(app, 'EnablHealthStack-dev', {
  config,
  environment: 'development',
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: 'us-east-1',
  },
  description: 'Enabl Health Platform - Complete Infrastructure (development) - Importing Existing Resources',
  tags: {
    Environment: 'development',
    Project: 'EnablHealth',
    Stack: 'unified-import',
  },
});

// Staging environment - import existing resources  
new EnablUnifiedStack(app, 'EnablHealthStack-staging', {
  config,
  environment: 'staging',
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: 'us-east-1',
  },
  description: 'Enabl Health Platform - Complete Infrastructure (staging) - Importing Existing Resources',
  tags: {
    Environment: 'staging',
    Project: 'EnablHealth',
    Stack: 'unified-import',
  },
});

// Production environment - import existing resources
new EnablUnifiedStack(app, 'EnablHealthStack-production', {
  config,
  environment: 'production',
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: 'us-east-1',
  },
  description: 'Enabl Health Platform - Complete Infrastructure (production) - Importing Existing Resources',
  tags: {
    Environment: 'production',
    Project: 'EnablHealth',
    Stack: 'unified-import',
  },
});
