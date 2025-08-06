import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import { EnablConfig, validateConfig } from './config';
import { BedrockAgentsStack } from './constructs/bedrock-agents-stack';

/**
 * Properties for the Enabl Backend Stack
 */
export interface EnablBackendStackProps extends cdk.StackProps {
  config: EnablConfig;
}

/**
 * Main backend infrastructure stack for Enabl Health
 * 
 * This stack creates and manages all core AWS resources:
 * - Cognito User Pool for authentication
 * - DynamoDB tables for data storage
 * - S3 buckets for file storage
 * - API Gateway for REST APIs
 * - Lambda functions for business logic
 */
export class EnablBackendStack extends cdk.Stack {
  public userPool: cognito.UserPool;
  public userPoolClient: cognito.UserPoolClient;
  public userPoolDomain: cognito.UserPoolDomain;
  public identityPool: cognito.CfnIdentityPool;
  
  public readonly dynamoTables: { [key: string]: dynamodb.Table } = {};
  public readonly s3Buckets: { [key: string]: s3.Bucket } = {};
  public api: apigateway.RestApi;

  constructor(scope: Construct, id: string, props: EnablBackendStackProps) {
    super(scope, id, props);

    const { config } = props;
    
    // Validate configuration
    validateConfig(config);

    // Create Cognito User Pool for authentication
    this.createCognitoResources(config);
    
    // Create DynamoDB tables
    this.createDynamoDBTables(config);
    
    // Create S3 buckets
    this.createS3Buckets(config);
    
    // Create API Gateway
    this.createApiGateway(config);
    
    // Create Bedrock AI Agents
    this.createBedrockAgents(config);
    
    // Create outputs for frontend integration
    this.createOutputs();
  }

  /**
   * Create Cognito resources for user authentication
   */
  private createCognitoResources(config: EnablConfig): void {
    // Create User Pool
    this.userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: config.cognito.userPoolName,
      selfSignUpEnabled: true,
      userVerification: {
        emailSubject: 'Welcome to enabl! Verify your email',
        emailBody: 'Hello! Welcome to enabl, your AI-powered everyday health assistant. Please verify your email by clicking this link: {##Verify Email##}',
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
      readAttributes: new cognito.ClientAttributes()
        .withStandardAttributes({
          email: true,
          emailVerified: true,
          givenName: true,
          familyName: true,
          phoneNumber: true,
          phoneNumberVerified: true,
        })
        .withCustomAttributes('isGuest', 'isPremium', 'preferences'),
      writeAttributes: new cognito.ClientAttributes()
        .withStandardAttributes({
          email: true,
          givenName: true,
          familyName: true,
          phoneNumber: true,
        })
        .withCustomAttributes('preferences'),
    });

    // Create User Pool Domain
    this.userPoolDomain = new cognito.UserPoolDomain(this, 'UserPoolDomain', {
      userPool: this.userPool,
      cognitoDomain: {
        domainPrefix: config.cognito.domainPrefix,
      },
    });

    // Create Google Identity Provider
    // Note: Google OAuth requires client secret to be configured
    // For testing purposes, we'll skip OAuth setup to avoid requiring secrets
    if (config.cognito.socialProviders.google.clientId !== 'PENDING' && 
        config.cognito.socialProviders.google.clientSecret && 
        config.cognito.socialProviders.google.clientSecret !== 'PENDING') {
      const googleProvider = new cognito.UserPoolIdentityProviderGoogle(this, 'GoogleProvider', {
        userPool: this.userPool,
        clientId: config.cognito.socialProviders.google.clientId,
        clientSecretValue: cdk.SecretValue.plainText(config.cognito.socialProviders.google.clientSecret),
        scopes: ['email', 'profile', 'openid'],
        attributeMapping: {
          email: cognito.ProviderAttribute.GOOGLE_EMAIL,
          givenName: cognito.ProviderAttribute.GOOGLE_GIVEN_NAME,
          familyName: cognito.ProviderAttribute.GOOGLE_FAMILY_NAME,
        },
      });

      // Add the provider to the client
      this.userPoolClient.node.addDependency(googleProvider);
    }

    // Create Identity Pool for AWS service access
    this.identityPool = new cognito.CfnIdentityPool(this, 'IdentityPool', {
      allowUnauthenticatedIdentities: true,
      cognitoIdentityProviders: [
        {
          clientId: this.userPoolClient.userPoolClientId,
          providerName: this.userPool.userPoolProviderName,
        },
      ],
    });

    // Create IAM roles for authenticated and unauthenticated users
    const authenticatedRole = new iam.Role(this, 'AuthenticatedRole', {
      assumedBy: new iam.FederatedPrincipal(
        'cognito-identity.amazonaws.com',
        {
          StringEquals: {
            'cognito-identity.amazonaws.com:aud': this.identityPool.ref,
          },
          'ForAnyValue:StringLike': {
            'cognito-identity.amazonaws.com:amr': 'authenticated',
          },
        },
        'sts:AssumeRoleWithWebIdentity'
      ),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonCognitoPowerUser'),
      ],
    });

    const unauthenticatedRole = new iam.Role(this, 'UnauthenticatedRole', {
      assumedBy: new iam.FederatedPrincipal(
        'cognito-identity.amazonaws.com',
        {
          StringEquals: {
            'cognito-identity.amazonaws.com:aud': this.identityPool.ref,
          },
          'ForAnyValue:StringLike': {
            'cognito-identity.amazonaws.com:amr': 'unauthenticated',
          },
        },
        'sts:AssumeRoleWithWebIdentity'
      ),
    });

    // Attach roles to identity pool
    new cognito.CfnIdentityPoolRoleAttachment(this, 'IdentityPoolRoleAttachment', {
      identityPoolId: this.identityPool.ref,
      roles: {
        authenticated: authenticatedRole.roleArn,
        unauthenticated: unauthenticatedRole.roleArn,
      },
    });
  }

  /**
   * Create DynamoDB tables for data storage
   */
  private createDynamoDBTables(config: EnablConfig): void {
    // Users table
    this.dynamoTables.users = new dynamodb.Table(this, 'UsersTable', {
      tableName: config.dynamodb.tables.users,
      partitionKey: {
        name: 'userId',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: config.dynamodb.pointInTimeRecovery,
      removalPolicy: config.environment === 'production' 
        ? cdk.RemovalPolicy.RETAIN 
        : cdk.RemovalPolicy.DESTROY,
    });

    // Chats table
    this.dynamoTables.chats = new dynamodb.Table(this, 'ChatsTable', {
      tableName: config.dynamodb.tables.chats,
      partitionKey: {
        name: 'userId',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'chatId',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: config.dynamodb.pointInTimeRecovery,
      removalPolicy: config.environment === 'production' 
        ? cdk.RemovalPolicy.RETAIN 
        : cdk.RemovalPolicy.DESTROY,
    });

    // Documents table
    this.dynamoTables.documents = new dynamodb.Table(this, 'DocumentsTable', {
      tableName: config.dynamodb.tables.documents,
      partitionKey: {
        name: 'userId',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'documentId',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: config.dynamodb.pointInTimeRecovery,
      removalPolicy: config.environment === 'production' 
        ? cdk.RemovalPolicy.RETAIN 
        : cdk.RemovalPolicy.DESTROY,
    });

    // Appointments table
    this.dynamoTables.appointments = new dynamodb.Table(this, 'AppointmentsTable', {
      tableName: config.dynamodb.tables.appointments,
      partitionKey: {
        name: 'userId',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'appointmentId',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: config.dynamodb.pointInTimeRecovery,
      removalPolicy: config.environment === 'production' 
        ? cdk.RemovalPolicy.RETAIN 
        : cdk.RemovalPolicy.DESTROY,
    });

    // Integrations table
    this.dynamoTables.integrations = new dynamodb.Table(this, 'IntegrationsTable', {
      tableName: config.dynamodb.tables.integrations,
      partitionKey: {
        name: 'userId',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'integrationId',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: config.dynamodb.pointInTimeRecovery,
      removalPolicy: config.environment === 'production' 
        ? cdk.RemovalPolicy.RETAIN 
        : cdk.RemovalPolicy.DESTROY,
    });

    // Reminders table for appointment agent
    this.dynamoTables.reminders = new dynamodb.Table(this, 'RemindersTable', {
      tableName: `enabl-reminders-${config.environment}`,
      partitionKey: {
        name: 'PK', // USER#userId
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'SK', // REMINDER#reminderId
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: config.dynamodb.pointInTimeRecovery,
      removalPolicy: config.environment === 'production' 
        ? cdk.RemovalPolicy.RETAIN 
        : cdk.RemovalPolicy.DESTROY,
    });

    // User preferences table for appointment agent
    this.dynamoTables.userPreferences = new dynamodb.Table(this, 'UserPreferencesTable', {
      tableName: `enabl-user-preferences-${config.environment}`,
      partitionKey: {
        name: 'PK', // USER#userId  
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'SK', // PREFERENCE#type
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: config.dynamodb.pointInTimeRecovery,
      removalPolicy: config.environment === 'production' 
        ? cdk.RemovalPolicy.RETAIN 
        : cdk.RemovalPolicy.DESTROY,
    });
  }

  /**
   * Create S3 buckets for file storage
   */
  private createS3Buckets(config: EnablConfig): void {
    // Documents bucket
    this.s3Buckets.documents = new s3.Bucket(this, 'DocumentsBucket', {
      bucketName: config.s3.buckets.documents,
      versioned: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      cors: [
        {
          allowedMethods: [
            s3.HttpMethods.GET,
            s3.HttpMethods.POST,
            s3.HttpMethods.PUT,
            s3.HttpMethods.DELETE,
          ],
          allowedOrigins: config.s3.corsOrigins,
          allowedHeaders: ['*'],
          exposedHeaders: ['ETag'],
          maxAge: 3000,
        },
      ],
      lifecycleRules: [
        {
          id: 'DeleteIncompleteMultipartUploads',
          abortIncompleteMultipartUploadAfter: cdk.Duration.days(7),
        },
      ],
      removalPolicy: config.environment === 'production' 
        ? cdk.RemovalPolicy.RETAIN 
        : cdk.RemovalPolicy.DESTROY,
    });

    // User uploads bucket
    this.s3Buckets.userUploads = new s3.Bucket(this, 'UserUploadsBucket', {
      bucketName: config.s3.buckets.userUploads,
      versioned: false,
      encryption: s3.BucketEncryption.S3_MANAGED,
      cors: [
        {
          allowedMethods: [
            s3.HttpMethods.GET,
            s3.HttpMethods.POST,
            s3.HttpMethods.PUT,
          ],
          allowedOrigins: config.s3.corsOrigins,
          allowedHeaders: ['*'],
          exposedHeaders: ['ETag'],
          maxAge: 3000,
        },
      ],
      lifecycleRules: [
        {
          id: 'DeleteOldUploads',
          expiration: cdk.Duration.days(30), // Auto-delete uploads after 30 days
        },
      ],
      removalPolicy: config.environment === 'production' 
        ? cdk.RemovalPolicy.RETAIN 
        : cdk.RemovalPolicy.DESTROY,
    });

    // Backups bucket
    this.s3Buckets.backups = new s3.Bucket(this, 'BackupsBucket', {
      bucketName: config.s3.buckets.backups,
      versioned: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: cdk.RemovalPolicy.RETAIN, // Always retain backups
    });
  }

  /**
   * Create API Gateway for REST APIs
   */
  private createApiGateway(config: EnablConfig): void {
    this.api = new apigateway.RestApi(this, 'Api', {
      restApiName: config.api.name,
      description: config.api.description,
      defaultCorsPreflightOptions: {
        allowOrigins: config.s3.corsOrigins,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: [
          'Content-Type',
          'X-Amz-Date',
          'Authorization',
          'X-Api-Key',
          'X-Amz-Security-Token',
        ],
      },
      deployOptions: {
        stageName: config.environment,
        throttlingRateLimit: config.api.throttle.rateLimit,
        throttlingBurstLimit: config.api.throttle.burstLimit,
        loggingLevel: apigateway.MethodLoggingLevel.INFO,
        dataTraceEnabled: config.monitoring.enableDetailedMetrics,
        metricsEnabled: config.monitoring.enableDetailedMetrics,
      },
    });

    // Create Cognito authorizer
    const cognitoAuthorizer = new apigateway.CognitoUserPoolsAuthorizer(this, 'CognitoAuthorizer', {
      cognitoUserPools: [this.userPool],
      authorizerName: 'EnablCognitoAuthorizer',
      identitySource: 'method.request.header.Authorization',
    });

    // Health check endpoint (no auth required)
    const healthResource = this.api.root.addResource('health');
    healthResource.addMethod('GET');

    // Protected API endpoints
    const apiV1 = this.api.root.addResource('api').addResource('v1');
    
    // User management endpoints
    const usersResource = apiV1.addResource('users');
    usersResource.addMethod('GET', undefined, {
      authorizer: cognitoAuthorizer,
    });
    usersResource.addMethod('PUT', undefined, {
      authorizer: cognitoAuthorizer,
    });

    // Chat endpoints
    const chatsResource = apiV1.addResource('chats');
    chatsResource.addMethod('GET', undefined, {
      authorizer: cognitoAuthorizer,
    });
    chatsResource.addMethod('POST', undefined, {
      authorizer: cognitoAuthorizer,
    });

    // Document endpoints
    const documentsResource = apiV1.addResource('documents');
    documentsResource.addMethod('GET', undefined, {
      authorizer: cognitoAuthorizer,
    });
    documentsResource.addMethod('POST', undefined, {
      authorizer: cognitoAuthorizer,
    });
  }

  /**
   * Create Bedrock AI Agents infrastructure
   */
  private createBedrockAgents(config: EnablConfig): void {
    const bedrockAgents = new BedrockAgentsStack(this, 'BedrockAgents', {
      environment: config.environment,
      userPoolId: this.userPool.userPoolId,
      userPoolClientId: this.userPoolClient.userPoolClientId,
    });

    // Add dependency to ensure proper order
    bedrockAgents.addDependency(this);
  }

  /**
   * Create CDK outputs for the stack
   */
  private createOutputs(): void {
    // Use stack name prefix to ensure unique output IDs across test instances
    const outputPrefix = this.stackName.replace(/[^a-zA-Z0-9]/g, '');

    // User Pool outputs
    new cdk.CfnOutput(this, `${outputPrefix}UserPoolId`, {
      value: this.userPool.userPoolId,
      description: 'Cognito User Pool ID',
      exportName: `${this.stackName}-UserPoolId`,
    });

    new cdk.CfnOutput(this, `${outputPrefix}UserPoolClientId`, {
      value: this.userPoolClient.userPoolClientId,
      description: 'Cognito User Pool Client ID',
      exportName: `${this.stackName}-UserPoolClientId`,
    });

    new cdk.CfnOutput(this, `${outputPrefix}UserPoolDomain`, {
      value: this.userPoolDomain.domainName,
      description: 'Cognito User Pool Domain',
      exportName: `${this.stackName}-UserPoolDomain`,
    });

    // DynamoDB outputs
    Object.entries(this.dynamoTables).forEach(([name, table]) => {
      new cdk.CfnOutput(this, `${outputPrefix}${name.charAt(0).toUpperCase() + name.slice(1)}TableName`, {
        value: table.tableName,
        description: `DynamoDB ${name} table name`,
        exportName: `${this.stackName}-${name}-table`,
      });
    });

    // S3 outputs
    Object.entries(this.s3Buckets).forEach(([name, bucket]) => {
      new cdk.CfnOutput(this, `${outputPrefix}${name.charAt(0).toUpperCase() + name.slice(1)}BucketName`, {
        value: bucket.bucketName,
        description: `S3 ${name} bucket name`,
        exportName: `${this.stackName}-${name}-bucket`,
      });
    });

    // API Gateway outputs
    new cdk.CfnOutput(this, `${outputPrefix}ApiGatewayId`, {
      value: this.api.restApiId,
      description: 'API Gateway REST API ID',
      exportName: `${this.stackName}-ApiGatewayId`,
    });

    new cdk.CfnOutput(this, `${outputPrefix}ApiGatewayUrl`, {
      value: this.api.url,
      description: 'API Gateway URL',
      exportName: `${this.stackName}-ApiGatewayUrl`,
    });
  }
}
