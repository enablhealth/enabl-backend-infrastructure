/**
 * Amazon Bedrock AI Agents Stack for Enabl Health
 * 
 * This stack creates:
 * - Knowledge Bases for RAG capabilities
 * - Lambda functions for AI agent processing
 * - S3 buckets for document storage
 * - API Gateway endpoints for chat functionality
 */

import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as opensearch from 'aws-cdk-lib/aws-opensearchserverless';
import { Construct } from 'constructs';

export interface BedrockAgentsStackProps extends cdk.StackProps {
  environment: string;
  userPoolId: string;
  userPoolClientId: string;
}

export class BedrockAgentsStack extends cdk.Stack {
  public readonly api: apigateway.RestApi;
  public readonly knowledgeBaseBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: BedrockAgentsStackProps) {
    super(scope, id, props);

    // S3 Bucket for Knowledge Base documents
    this.knowledgeBaseBucket = new s3.Bucket(this, 'KnowledgeBaseBucket', {
      bucketName: `enabl-knowledge-base-${props.environment}`,
      versioned: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: props.environment === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      lifecycleRules: [
        {
          id: 'DeleteOldVersions',
          enabled: true,
          noncurrentVersionExpiration: cdk.Duration.days(30),
        },
      ],
    });

    // OpenSearch Serverless Collection for Vector Database
    const vectorCollection = new opensearch.CfnCollection(this, 'VectorCollection', {
      name: `enabl-vectors-${props.environment}`,
      type: 'VECTORSEARCH',
      description: 'Vector database for Enabl Health knowledge base',
    });

    // IAM Role for Bedrock Knowledge Base
    const knowledgeBaseRole = new iam.Role(this, 'KnowledgeBaseRole', {
      assumedBy: new iam.ServicePrincipal('bedrock.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonBedrockFullAccess'),
      ],
      inlinePolicies: {
        S3Access: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['s3:GetObject', 's3:ListBucket'],
              resources: [
                this.knowledgeBaseBucket.bucketArn,
                `${this.knowledgeBaseBucket.bucketArn}/*`,
              ],
            }),
          ],
        }),
        OpenSearchAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'aoss:APIAccessAll',
                'aoss:DashboardsAccessAll',
              ],
              resources: [vectorCollection.attrArn],
            }),
          ],
        }),
      },
    });

    // Lambda Layer for AWS SDK and dependencies
    const awsSdkLayer = new lambda.LayerVersion(this, 'AwsSdkLayer', {
      code: lambda.Code.fromAsset('lambda-layers/aws-sdk'),
      compatibleRuntimes: [lambda.Runtime.NODEJS_18_X],
      description: 'AWS SDK for Bedrock and utilities',
    });

    // Lambda function for Health Assistant Agent
    const healthAssistantFunction = new lambda.Function(this, 'HealthAssistantFunction', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lib/lambda/health-assistant'),
      timeout: cdk.Duration.minutes(5),
      memorySize: 1024,
      layers: [awsSdkLayer],
      environment: {
        KNOWLEDGE_BASE_ID: 'kb-health-guidelines', // Will be created manually or via CDK
        MODEL_ID: 'anthropic.claude-3-sonnet-20240229-v1:0',
        REGION: this.region,
        ENVIRONMENT: props.environment,
      },
    });

    // Lambda function for Community Agent
    const communityAgentFunction = new lambda.Function(this, 'CommunityAgentFunction', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lib/lambda/community-agent'),
      timeout: cdk.Duration.minutes(3),
      memorySize: 512,
      layers: [awsSdkLayer],
      environment: {
        KNOWLEDGE_BASE_ID: 'kb-community-content',
        MODEL_ID: 'amazon.titan-text-express-v1',
        REGION: this.region,
        ENVIRONMENT: props.environment,
      },
    });

    // Lambda function for Document Agent
    const documentAgentFunction = new lambda.Function(this, 'DocumentAgentFunction', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lib/lambda/document-agent'),
      timeout: cdk.Duration.minutes(5),
      memorySize: 1024,
      layers: [awsSdkLayer],
      environment: {
        KNOWLEDGE_BASE_ID: 'kb-user-documents',
        MODEL_ID: 'cohere.command-text-v14',
        REGION: this.region,
        ENVIRONMENT: props.environment,
        DOCUMENTS_BUCKET: this.knowledgeBaseBucket.bucketName,
      },
    });

    // Chat Router Lambda - routes requests to appropriate agents
    const chatRouterFunction = new lambda.Function(this, 'ChatRouterFunction', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lib/lambda/chat-router'),
      timeout: cdk.Duration.minutes(1),
      memorySize: 256,
      environment: {
        HEALTH_ASSISTANT_FUNCTION: healthAssistantFunction.functionName,
        COMMUNITY_AGENT_FUNCTION: communityAgentFunction.functionName,
        DOCUMENT_AGENT_FUNCTION: documentAgentFunction.functionName,
        REGION: this.region,
      },
    });

    // Grant permissions for Bedrock
    const bedrockPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'bedrock:InvokeModel',
        'bedrock:InvokeModelWithResponseStream',
        'bedrock:RetrieveAndGenerate',
        'bedrock:Retrieve',
      ],
      resources: ['*'],
    });

    healthAssistantFunction.addToRolePolicy(bedrockPolicy);
    communityAgentFunction.addToRolePolicy(bedrockPolicy);
    documentAgentFunction.addToRolePolicy(bedrockPolicy);

    // Grant Lambda invoke permissions to chat router
    healthAssistantFunction.grantInvoke(chatRouterFunction);
    communityAgentFunction.grantInvoke(chatRouterFunction);
    documentAgentFunction.grantInvoke(chatRouterFunction);

    // Grant S3 permissions to document agent
    this.knowledgeBaseBucket.grantReadWrite(documentAgentFunction);

    // API Gateway for chat endpoints
    this.api = new apigateway.RestApi(this, 'EnablAiApi', {
      restApiName: `enabl-ai-api-${props.environment}`,
      description: 'Enabl Health AI Agents API',
      defaultCorsPreflightOptions: {
        allowOrigins: props.environment === 'prod' 
          ? ['https://enabl.health']
          : ['http://localhost:3000', 'https://dev.enabl.health', 'https://staging.enabl.health'],
        allowMethods: ['GET', 'POST', 'OPTIONS'],
        allowHeaders: ['Content-Type', 'Authorization'],
      },
    });

    // Cognito Authorizer
    const cognitoAuthorizer = new apigateway.CognitoUserPoolsAuthorizer(this, 'CognitoAuthorizer', {
      cognitoUserPools: [
        cognito.UserPool.fromUserPoolId(this, 'UserPool', props.userPoolId)
      ],
      authorizerName: 'EnablCognitoAuthorizer',
    });

    // Chat endpoint
    const chatResource = this.api.root.addResource('chat');
    
    // POST /chat - Main chat endpoint
    chatResource.addMethod('POST', new apigateway.LambdaIntegration(chatRouterFunction), {
      authorizer: cognitoAuthorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // Agent-specific endpoints
    const agentsResource = this.api.root.addResource('agents');
    
    // Health Assistant
    const healthResource = agentsResource.addResource('health');
    healthResource.addMethod('POST', new apigateway.LambdaIntegration(healthAssistantFunction), {
      authorizer: cognitoAuthorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // Community Agent
    const communityResource = agentsResource.addResource('community');
    communityResource.addMethod('POST', new apigateway.LambdaIntegration(communityAgentFunction), {
      authorizer: cognitoAuthorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // Document Agent
    const documentsResource = agentsResource.addResource('documents');
    documentsResource.addMethod('POST', new apigateway.LambdaIntegration(documentAgentFunction), {
      authorizer: cognitoAuthorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // Outputs
    new cdk.CfnOutput(this, 'ApiUrl', {
      value: this.api.url,
      description: 'API Gateway URL for AI agents',
    });

    new cdk.CfnOutput(this, 'KnowledgeBaseBucketName', {
      value: this.knowledgeBaseBucket.bucketName,
      description: 'S3 bucket for knowledge base documents',
    });

    new cdk.CfnOutput(this, 'VectorCollectionArn', {
      value: vectorCollection.attrArn,
      description: 'OpenSearch Serverless collection for vectors',
    });
  }
}
