#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { SimpleSecretsStack } from '../lib/simple-secrets-stack';

const app = new cdk.App();

// Get environment from context
const environment = app.node.tryGetContext('environment') || 'development';

console.log(`🔐 Deploying secrets for environment: ${environment}`);

new SimpleSecretsStack(app, `EnablSecretsStack-${environment}`, {
  environment: environment as 'development' | 'staging' | 'production',
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: 'us-east-1',
  },
  tags: {
    Project: 'EnablHealth',
    Environment: environment,
    Component: 'SecretsManager',
  },
});
