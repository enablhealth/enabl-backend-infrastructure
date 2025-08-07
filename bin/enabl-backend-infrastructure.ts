#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { EnablBackendStack } from '../lib/enabl-backend-stack';
import { EnablAgentRouterStack } from '../lib/agent-router-stack';
import { KnowledgeBaseStack } from '../lib/knowledge-base-s3-stack';
import { EnablConfig, getConfig } from '../lib/config';

/**
 * Main CDK application entry point for Enabl Health backend infrastructure
 * 
 * This application creates and manages all AWS resources for the Enabl Health platform:
 * - Cognito User Pools for authentication
 * - DynamoDB tables for data storage
 * - S3 buckets for file storage
 * - API Gateway for REST APIs
 * - Lambda functions for business logic
 * - CloudFront distributions for content delivery
 */

const app = new cdk.App();

// Get environment from context or default to development
const environment = app.node.tryGetContext('environment') || 'development';
console.log(`🚀 Deploying Enabl Health infrastructure for environment: ${environment}`);

// Load configuration for the specified environment
const config: EnablConfig = getConfig(environment);

// Create the main backend stack
new EnablBackendStack(app, `EnablBackend-${config.environment}`, {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: config.region, // Default to us-east-1 for global users
  },
  config,
  stackName: `enabl-backend-${config.environment}`,
  description: `Enabl Health Backend Infrastructure - ${config.environment} environment`,
  tags: {
    Project: 'EnablHealth',
    Environment: config.environment,
    Owner: 'EnablHealth',
    CostCenter: 'Engineering',
    ManagedBy: 'CDK',
  },
});

//

// Create the Agent Router stack for Bedrock AgentCore
new EnablAgentRouterStack(app, `EnablAgentRouter-${config.environment}`, {
  environment: config.environment,
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: config.region,
  },
  stackName: `enabl-agent-router-${config.environment}`,
  description: `Enabl Health Agent Router Infrastructure - ${config.environment} environment`,
  tags: {
    Project: 'EnablHealth',
    Environment: config.environment,
    Component: 'AgentRouter',
    Owner: 'EnablHealth',
    CostCenter: 'Engineering',
    ManagedBy: 'CDK',
  },
});

// Create the Knowledge Base stack for medical documents
new KnowledgeBaseStack(app, `EnablKnowledgeBase-${config.environment}`, {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: config.region,
  },
  environment: config.environment,
  stackName: `enabl-knowledge-base-${config.environment}`,
  description: `Enabl Health Knowledge Base Infrastructure - ${config.environment} environment`,
  tags: {
    Project: 'EnablHealth',
    Environment: config.environment,
    Component: 'KnowledgeBase',
    Owner: 'EnablHealth',
    CostCenter: 'Engineering',
    ManagedBy: 'CDK',
  },
});

// Output deployment information
console.log(`✅ CDK app synthesized for ${environment} environment`);
console.log(`📍 Region: ${config.region}`);
console.log(`🏷️  Stack: EnablBackend-${config.environment}`);
