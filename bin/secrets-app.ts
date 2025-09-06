#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { EnablSecretsStack } from '../lib/enabl-secrets-stack';

/**
 * CDK App for deploying only AWS Secrets Manager secrets
 * for Enabl Health third-party integrations
 * 
 * This deploys secrets for:
 * - Google OAuth credentials  
 * - Apple Sign-In credentials
 * 
 * Across all environments: development, staging, production
 */

const app = new cdk.App();

// Get environment from context or deploy all environments
const environment = app.node.tryGetContext('environment');

if (environment) {
  // Deploy single environment
  console.log(`🔐 Deploying secrets for environment: ${environment}`);
  
  new EnablSecretsStack(app, `EnablSecretsStack-${environment}`, {
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
} else {
  // Deploy all environments
  console.log('🔐 Deploying secrets for all environments');
  
  const environments: Array<'development' | 'staging' | 'production'> = [
    'development',
    'staging', 
    'production'
  ];
  
  environments.forEach(env => {
    new EnablSecretsStack(app, `EnablSecretsStack-${env}`, {
      environment: env,
      env: {
        account: process.env.CDK_DEFAULT_ACCOUNT,
        region: 'us-east-1',
      },
      tags: {
        Project: 'EnablHealth',
        Environment: env,
        Component: 'SecretsManager',
      },
    });
  });
}
