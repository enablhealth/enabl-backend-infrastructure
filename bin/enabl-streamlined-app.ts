#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { EnablBackendStack } from '../lib/enabl-backend-stack-new';
import { getConfig } from '../lib/config-new';

const app = new cdk.App();

// Get environment from context (defaults to development)
const environment = app.node.tryGetContext('environment') || 'development';
const config = getConfig(environment);

console.log(`🚀 Deploying Enabl Backend for environment: ${environment}`);

// Create the main backend stack
new EnablBackendStack(app, `EnablBackendStack-${environment}`, {
  config,
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: 'us-east-1',
  },
  description: `Enabl Health Backend Infrastructure - ${environment} environment`,
});

// Add tags to all resources
cdk.Tags.of(app).add('Project', 'EnablHealth');
cdk.Tags.of(app).add('Environment', environment);
cdk.Tags.of(app).add('Owner', 'EnablHealth');
