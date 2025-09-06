import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as bedrock from 'aws-cdk-lib/aws-bedrock';
import * as opensearch from 'aws-cdk-lib/aws-opensearchserverless';
import { Construct } from 'constructs';
import { EnablConfig, validateConfig } from './config-new';

/**
 * Properties for the Enabl Backend Stack
 */
export interface EnablBackendStackProps extends cdk.StackProps {
  config: EnablConfig;
}

/**
 * Streamlined backend infrastructure stack for Enabl Health
 * 
 * Focus on essential services aligned with copilot instructions:
 * - Cognito User Pools for authentication (per environment isolation)
 * - DynamoDB tables for data storage (users, chats, documents)
 * - S3 buckets for document and knowledge base storage
 * - Amazon Bedrock agents for AI functionality
 * - AWS Secrets Manager for secure credential storage
 * - OpenSearch Serverless for vector storage
 * 
 * Removed services (handled by Next.js + App Runner):
 * - API Gateway (Next.js API routes)
 * - Lambda functions (Next.js serverless functions)
 * - Custom domain management (App Runner + CloudFront)
 */
export class EnablBackendStack extends cdk.Stack {
  public userPool: cognito.UserPool;
  public userPoolClient: cognito.UserPoolClient;
  public userPoolDomain: cognito.UserPoolDomain;
  public identityPool: cognito.CfnIdentityPool;
  
  public readonly dynamoTables: { [key: string]: dynamodb.Table } = {};
  public readonly s3Buckets: { [key: string]: s3.Bucket } = {};
  public readonly secrets: { [key: string]: secretsmanager.Secret } = {};
  public readonly bedrockAgents: { [key: string]: bedrock.CfnAgent } = {};
  public knowledgeBase: bedrock.CfnKnowledgeBase;
  public vectorCollection: opensearch.CfnCollection;

  constructor(scope: Construct, id: string, props: EnablBackendStackProps) {
    super(scope, id, props);

    const { config } = props;
    
    // Validate configuration
    validateConfig(config);

    // Create Cognito User Pool for authentication
    this.createCognitoResources(config);
    
    // Create DynamoDB tables for data storage
    this.createDynamoDBTables(config);
    
    // Create S3 buckets for document and knowledge base storage
    this.createS3Buckets(config);
    
    // Create AWS Secrets Manager secrets for third-party credentials
    this.createSecretsManager(config);
    
    // Create OpenSearch Serverless for vector storage
    this.createVectorDatabase(config);
    
    // Create Amazon Bedrock Knowledge Base
    this.createKnowledgeBase(config);
    
    // Create Amazon Bedrock AI Agents
    this.createBedrockAgents(config);
    
    // Create CloudFormation outputs for frontend integration
    this.createOutputs();
  }

  /**
   * Create Cognito resources for user authentication
   * Environment-specific user pools for complete isolation
   */
  private createCognitoResources(config: EnablConfig): void {
    // Create User Pool
    this.userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: config.cognito.userPoolName,
      selfSignUpEnabled: true,
      userVerification: {
        emailSubject: 'Welcome to Enabl Health! Verify your email',
        emailBody: 'Hello! Welcome to Enabl Health, your AI-powered everyday health assistant. Please verify your email by clicking this link: {##Verify Email##}',
        emailStyle: cognito.VerificationEmailStyle.LINK,
      },
      signInAliases: {
        email: true,
        phone: true,
        username: false,
      },
      autoVerify: {
        email: true,
        phone: true,
      },
      standardAttributes: {
        email: {
          required: true,
          mutable: true,
        },
        givenName: {
          required: false,
          mutable: true,
        },
        familyName: {
          required: false,
          mutable: true,
        },
        phoneNumber: {
          required: false,
          mutable: true,
        },
      },
      customAttributes: {
        isGuest: new cognito.BooleanAttribute({ mutable: true }),
        isPremium: new cognito.BooleanAttribute({ mutable: true }),
        lastLoginAt: new cognito.StringAttribute({ mutable: true }),
        preferences: new cognito.StringAttribute({ mutable: true }),
        agentPreferences: new cognito.StringAttribute({ mutable: true }),
      },
      passwordPolicy: {
        minLength: config.cognito.passwordPolicy.minLength,
        requireLowercase: config.cognito.passwordPolicy.requireLowercase,
        requireUppercase: config.cognito.passwordPolicy.requireUppercase,
        requireDigits: config.cognito.passwordPolicy.requireDigits,
        requireSymbols: config.cognito.passwordPolicy.requireSymbols,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_AND_PHONE_WITHOUT_MFA,
      removalPolicy: config.environment === 'production' 
        ? cdk.RemovalPolicy.RETAIN 
        : cdk.RemovalPolicy.DESTROY,
    });

    // Create User Pool Client
    this.userPoolClient = new cognito.UserPoolClient(this, 'UserPoolClient', {
      userPool: this.userPool,
      userPoolClientName: config.cognito.userPoolClientName,
      generateSecret: false, // Required for web applications
      authFlows: {
        adminUserPassword: false,
        custom: false,
        userSrp: true,
        userPassword: false,
      },
      oAuth: {
        flows: {
          authorizationCodeGrant: true,
          implicitCodeGrant: false,
        },
        scopes: [
          cognito.OAuthScope.EMAIL,
          cognito.OAuthScope.OPENID,
          cognito.OAuthScope.PROFILE,
        ],
        callbackUrls: config.cognito.oauth.callbackUrls,
        logoutUrls: config.cognito.oauth.logoutUrls,
      },
      preventUserExistenceErrors: true,
    });

    // Create User Pool Domain
    this.userPoolDomain = new cognito.UserPoolDomain(this, 'UserPoolDomain', {
      userPool: this.userPool,
      cognitoDomain: {
        domainPrefix: config.cognito.domainPrefix,
      },
    });

    // Create Identity Pool for AWS resource access
    this.identityPool = new cognito.CfnIdentityPool(this, 'IdentityPool', {
      allowUnauthenticatedIdentities: true, // For guest users
      cognitoIdentityProviders: [{
        clientId: this.userPoolClient.userPoolClientId,
        providerName: this.userPool.userPoolProviderName,
      }],
    });
  }

  /**
   * Create DynamoDB tables for data storage
   * Environment-specific tables with appropriate billing and backup
   */
  private createDynamoDBTables(config: EnablConfig): void {
    // Users table
    this.dynamoTables.users = new dynamodb.Table(this, 'UsersTable', {
      tableName: config.dynamodb.tables.users,
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      billingMode: config.dynamodb.billingMode === 'PAY_PER_REQUEST' 
        ? dynamodb.BillingMode.PAY_PER_REQUEST 
        : dynamodb.BillingMode.PROVISIONED,
      pointInTimeRecovery: config.dynamodb.pointInTimeRecovery,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      removalPolicy: config.environment === 'production' 
        ? cdk.RemovalPolicy.RETAIN 
        : cdk.RemovalPolicy.DESTROY,
    });

    // Chat history table
    this.dynamoTables.chats = new dynamodb.Table(this, 'ChatsTable', {
      tableName: config.dynamodb.tables.chats,
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'chatId', type: dynamodb.AttributeType.STRING },
      billingMode: config.dynamodb.billingMode === 'PAY_PER_REQUEST' 
        ? dynamodb.BillingMode.PAY_PER_REQUEST 
        : dynamodb.BillingMode.PROVISIONED,
      pointInTimeRecovery: config.dynamodb.pointInTimeRecovery,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      removalPolicy: config.environment === 'production' 
        ? cdk.RemovalPolicy.RETAIN 
        : cdk.RemovalPolicy.DESTROY,
    });

    // Add GSI for chat queries by timestamp
    this.dynamoTables.chats.addGlobalSecondaryIndex({
      indexName: 'ChatsByTimestamp',
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.STRING },
    });

    // Documents table
    this.dynamoTables.documents = new dynamodb.Table(this, 'DocumentsTable', {
      tableName: config.dynamodb.tables.documents,
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'documentId', type: dynamodb.AttributeType.STRING },
      billingMode: config.dynamodb.billingMode === 'PAY_PER_REQUEST' 
        ? dynamodb.BillingMode.PAY_PER_REQUEST 
        : dynamodb.BillingMode.PROVISIONED,
      pointInTimeRecovery: config.dynamodb.pointInTimeRecovery,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      removalPolicy: config.environment === 'production' 
        ? cdk.RemovalPolicy.RETAIN 
        : cdk.RemovalPolicy.DESTROY,
    });
  }

  /**
   * Create S3 buckets for document and knowledge base storage
   * Environment-specific buckets with appropriate security and lifecycle policies
   */
  private createS3Buckets(config: EnablConfig): void {
    // Documents bucket for user uploads
    this.s3Buckets.documents = new s3.Bucket(this, 'DocumentsBucket', {
      bucketName: config.s3.buckets.documents,
      versioned: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      cors: [{
        allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.POST, s3.HttpMethods.PUT],
        allowedOrigins: config.s3.corsOrigins,
        allowedHeaders: ['*'],
        maxAge: 3600,
      }],
      lifecycleRules: [{
        id: 'DeleteOldVersions',
        enabled: true,
        noncurrentVersionExpiration: cdk.Duration.days(30),
      }],
      removalPolicy: config.environment === 'production' 
        ? cdk.RemovalPolicy.RETAIN 
        : cdk.RemovalPolicy.DESTROY,
    });

    // Knowledge base bucket for AI agent training data
    this.s3Buckets.knowledgeBase = new s3.Bucket(this, 'KnowledgeBaseBucket', {
      bucketName: config.s3.buckets.knowledgeBase,
      versioned: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: config.environment === 'production' 
        ? cdk.RemovalPolicy.RETAIN 
        : cdk.RemovalPolicy.DESTROY,
    });
  }

  /**
   * Create AWS Secrets Manager secrets for secure credential storage
   * Environment-specific secrets for third-party integrations
   */
  private createSecretsManager(config: EnablConfig): void {
    // Google OAuth credentials
    this.secrets.googleOAuth = new secretsmanager.Secret(this, 'GoogleOAuthSecret', {
      secretName: config.secretsManager.googleOAuth,
      description: `Google OAuth credentials for ${config.environment} environment`,
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ clientId: '' }),
        generateStringKey: 'clientSecret',
        excludeCharacters: ' %+~`#$&*()|[]{}:;<>?!\'/@"\\',
      },
    });

    // Apple Sign-In credentials
    this.secrets.appleSignIn = new secretsmanager.Secret(this, 'AppleSignInSecret', {
      secretName: config.secretsManager.appleSignIn,
      description: `Apple Sign-In credentials for ${config.environment} environment`,
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ 
          teamId: '', 
          keyId: '', 
          serviceId: '' 
        }),
        generateStringKey: 'privateKey',
        excludeCharacters: ' %+~`#$&*()|[]{}:;<>?!\'/@"\\',
      },
    });
  }

  /**
   * Create OpenSearch Serverless collection for vector storage
   * Environment-specific vector database for knowledge base
   */
  private createVectorDatabase(config: EnablConfig): void {
    this.vectorCollection = new opensearch.CfnCollection(this, 'VectorCollection', {
      name: `enabl-vectors-${config.environment}`,
      type: 'VECTORSEARCH',
      description: `Vector database for ${config.environment} knowledge base`,
    });
  }

  /**
   * Create Amazon Bedrock Knowledge Base
   * Environment-specific knowledge base with vector storage
   */
  private createKnowledgeBase(config: EnablConfig): void {
    // Create IAM role for Bedrock Knowledge Base
    const knowledgeBaseRole = new iam.Role(this, 'KnowledgeBaseRole', {
      assumedBy: new iam.ServicePrincipal('bedrock.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonBedrockFullAccess'),
      ],
    });

    // Grant access to S3 bucket
    this.s3Buckets.knowledgeBase.grantRead(knowledgeBaseRole);

    this.knowledgeBase = new bedrock.CfnKnowledgeBase(this, 'KnowledgeBase', {
      name: config.bedrock.knowledgeBase.name,
      description: config.bedrock.knowledgeBase.description,
      roleArn: knowledgeBaseRole.roleArn,
      knowledgeBaseConfiguration: {
        type: 'VECTOR',
        vectorKnowledgeBaseConfiguration: {
          embeddingModelArn: `arn:aws:bedrock:${config.region}::foundation-model/amazon.titan-embed-text-v1`,
        },
      },
      storageConfiguration: {
        type: 'OPENSEARCH_SERVERLESS',
        opensearchServerlessConfiguration: {
          collectionArn: this.vectorCollection.attrArn,
          vectorIndexName: 'enabl-index',
          fieldMapping: {
            vectorField: 'vector',
            textField: 'text',
            metadataField: 'metadata',
          },
        },
      },
    });
  }

  /**
   * Create Amazon Bedrock AI Agents
   * Environment-specific agents with Amazon foundation models
   */
  private createBedrockAgents(config: EnablConfig): void {
    // Create IAM role for Bedrock Agents
    const agentRole = new iam.Role(this, 'BedrockAgentRole', {
      assumedBy: new iam.ServicePrincipal('bedrock.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonBedrockFullAccess'),
      ],
    });

    // Health Assistant Agent
    this.bedrockAgents.healthAssistant = new bedrock.CfnAgent(this, 'HealthAssistantAgent', {
      agentName: config.bedrock.agents.healthAssistant.name,
      description: 'AI health assistant providing evidence-based health guidance and consultation',
      agentResourceRoleArn: agentRole.roleArn,
      foundationModel: config.bedrock.agents.healthAssistant.model,
      instruction: 'You are a helpful health assistant that provides evidence-based health guidance. Always prioritize user safety and recommend consulting healthcare professionals for serious concerns.',
      knowledgeBases: [{
        knowledgeBaseId: this.knowledgeBase.ref,
        description: 'Medical guidelines and health information',
      }],
    });

    // Community Agent
    this.bedrockAgents.communityAgent = new bedrock.CfnAgent(this, 'CommunityAgent', {
      agentName: config.bedrock.agents.communityAgent.name,
      description: 'AI agent for community content curation and health resource discovery',
      agentResourceRoleArn: agentRole.roleArn,
      foundationModel: config.bedrock.agents.communityAgent.model,
      instruction: 'You are a community content curator that helps discover relevant health and wellness resources. Focus on credible sources and fact-checking.',
      knowledgeBases: [{
        knowledgeBaseId: this.knowledgeBase.ref,
        description: 'Community health content and resources',
      }],
    });

    // Appointment Agent
    this.bedrockAgents.appointmentAgent = new bedrock.CfnAgent(this, 'AppointmentAgent', {
      agentName: config.bedrock.agents.appointmentAgent.name,
      description: 'AI agent for intelligent appointment scheduling and healthcare management',
      agentResourceRoleArn: agentRole.roleArn,
      foundationModel: config.bedrock.agents.appointmentAgent.model,
      instruction: 'You are an appointment scheduling assistant that helps users manage their healthcare appointments efficiently and intelligently.',
    });

    // Document Agent
    this.bedrockAgents.documentAgent = new bedrock.CfnAgent(this, 'DocumentAgent', {
      agentName: config.bedrock.agents.documentAgent.name,
      description: 'AI agent for secure document analysis and medical document understanding',
      agentResourceRoleArn: agentRole.roleArn,
      foundationModel: config.bedrock.agents.documentAgent.model,
      instruction: 'You are a document analysis assistant that helps users understand and organize their medical documents securely and intelligently.',
      knowledgeBases: [{
        knowledgeBaseId: this.knowledgeBase.ref,
        description: 'Document analysis and medical terminology',
      }],
    });
  }

  /**
   * Create CloudFormation outputs for frontend integration
   * These values will be used by the Next.js application
   */
  private createOutputs(): void {
    // Cognito outputs
    new cdk.CfnOutput(this, 'UserPoolId', {
      value: this.userPool.userPoolId,
      description: 'Cognito User Pool ID',
    });

    new cdk.CfnOutput(this, 'UserPoolClientId', {
      value: this.userPoolClient.userPoolClientId,
      description: 'Cognito User Pool Client ID',
    });

    new cdk.CfnOutput(this, 'UserPoolDomainName', {
      value: this.userPoolDomain.domainName,
      description: 'Cognito User Pool Domain',
    });

    new cdk.CfnOutput(this, 'IdentityPoolId', {
      value: this.identityPool.ref,
      description: 'Cognito Identity Pool ID',
    });

    // DynamoDB outputs
    Object.entries(this.dynamoTables).forEach(([name, table]) => {
      new cdk.CfnOutput(this, `${name}TableName`, {
        value: table.tableName,
        description: `DynamoDB ${name} table name`,
      });
    });

    // S3 outputs
    Object.entries(this.s3Buckets).forEach(([name, bucket]) => {
      new cdk.CfnOutput(this, `${name}BucketName`, {
        value: bucket.bucketName,
        description: `S3 ${name} bucket name`,
      });
    });

    // Bedrock Agent outputs
    Object.entries(this.bedrockAgents).forEach(([name, agent]) => {
      new cdk.CfnOutput(this, `${name}AgentId`, {
        value: agent.ref,
        description: `Bedrock ${name} agent ID`,
      });
    });

    // Knowledge Base output
    new cdk.CfnOutput(this, 'KnowledgeBaseId', {
      value: this.knowledgeBase.ref,
      description: 'Bedrock Knowledge Base ID',
    });

    // Secrets Manager outputs (ARNs only, not the actual secrets)
    Object.entries(this.secrets).forEach(([name, secret]) => {
      new cdk.CfnOutput(this, `${name}SecretArn`, {
        value: secret.secretArn,
        description: `${name} secret ARN`,
      });
    });
  }
}
