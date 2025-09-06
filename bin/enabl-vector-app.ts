#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { EnablBackendStack } from '../lib/enabl-backend-stack';
import { OpenSearchVectorStack } from '../lib/opensearch-vector-stack';
import { BedrockKnowledgeBaseStack } from '../lib/bedrock-knowledge-base-stack';
import { EnablConfig, getConfig } from '../lib/config';

const app = new cdk.App();

// Get environment from context or default to development
const environment = app.node.tryGetContext('environment') || 'development';

console.log(`🚀 Deploying Enabl Vector & Knowledge Base Infrastructure for environment: ${environment}`);

// Load configuration for the specified environment
const config: EnablConfig = getConfig(environment);

// Main backend stack (existing)
const backendStack = new EnablBackendStack(app, `EnablBackendStack-${environment}`, {
  config,
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || 'us-east-1',
  },
});

// OpenSearch Vector Stack for semantic search
const openSearchStack = new OpenSearchVectorStack(app, `EnablOpenSearchVectorStack-${environment}`, {
  environment,
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || 'us-east-1',
  },
});

// Bedrock Knowledge Base Stack for personalized AI
const knowledgeBaseStack = new BedrockKnowledgeBaseStack(app, `EnablBedrockKnowledgeBaseStack-${environment}`, {
  environment,
  openSearchCollectionArn: openSearchStack.collectionArn,
  openSearchCollectionEndpoint: openSearchStack.collectionEndpoint,
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || 'us-east-1',
  },
});

// Ensure proper deployment order
knowledgeBaseStack.addDependency(openSearchStack);

// Add tags to all stacks
const tags = {
  Project: 'EnablHealth',
  Environment: environment,
  Owner: 'EnablHealth-Team',
  Purpose: 'HealthcareAI-Platform'
};

Object.entries(tags).forEach(([key, value]) => {
  cdk.Tags.of(backendStack).add(key, value);
  cdk.Tags.of(openSearchStack).add(key, value);
  cdk.Tags.of(knowledgeBaseStack).add(key, value);
});
