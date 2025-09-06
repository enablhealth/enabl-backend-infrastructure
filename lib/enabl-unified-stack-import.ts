import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as s3n from 'aws-cdk-lib/aws-s3-notifications';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as opensearchserverless from 'aws-cdk-lib/aws-opensearchserverless';
import * as bedrock from 'aws-cdk-lib/aws-bedrock';
import * as cr from 'aws-cdk-lib/custom-resources';
import { EnablConfig } from './config';

export interface EnablUnifiedStackProps extends cdk.StackProps {
  config: EnablConfig;
  environment: string;
}

export class EnablUnifiedStack extends cdk.Stack {
  // Core Services
  public readonly userTable: dynamodb.ITable;
  public readonly chatTable: dynamodb.ITable;
  public readonly documentsTable: dynamodb.ITable;
  public readonly appointmentsTable: dynamodb.ITable;
  public readonly integrationsTable: dynamodb.ITable;
  
  // Storage
  public readonly documentsBucket: s3.IBucket;
  public readonly knowledgeBaseBucket: s3.IBucket;
  public readonly userUploadsBucket: s3.IBucket;
  public readonly backupsBucket: s3.IBucket;
  
  // Authentication
  public readonly userPool: cognito.IUserPool;
  public readonly userPoolClient: cognito.UserPoolClient;
  
  // Vector Search & AI
  public readonly vectorCollection: opensearchserverless.CfnCollection;
  
  // APIs
  public readonly mainApi: apigateway.IRestApi;
  public readonly aiApi: apigateway.IRestApi;

  constructor(scope: Construct, id: string, props: EnablUnifiedStackProps) {
    super(scope, id, props);

    const { config, environment } = props;

    // Map environment names to existing convention
    const envName = this.getEnvironmentName(environment);

    // ===========================================
    // 1. IMPORT EXISTING DYNAMODB TABLES
    // ===========================================
    
    // Import existing users table
    this.userTable = dynamodb.Table.fromTableName(this, 'UsersTable', `enabl-users-${envName}`);

    // Import existing chat table - check which name exists
    const chatTableName = this.getChatTableName(envName);
    this.chatTable = dynamodb.Table.fromTableName(this, 'ChatHistoryTable', chatTableName);

    // Import existing documents table
    this.documentsTable = dynamodb.Table.fromTableName(this, 'DocumentsTable', `enabl-documents-${envName}`);

    // Import existing appointments table
    this.appointmentsTable = dynamodb.Table.fromTableName(this, 'AppointmentsTable', `enabl-appointments-${envName}`);

    // Import existing integrations table
    this.integrationsTable = dynamodb.Table.fromTableName(this, 'IntegrationsTable', `enabl-integrations-${envName}`);

    // ===========================================
    // 2. IMPORT EXISTING S3 BUCKETS
    // ===========================================
    
    this.documentsBucket = s3.Bucket.fromBucketName(this, 'DocumentsBucket', `enabl-documents-${envName}`);
    this.userUploadsBucket = s3.Bucket.fromBucketName(this, 'UserUploadsBucket', `enabl-user-uploads-${envName}`);
    this.backupsBucket = s3.Bucket.fromBucketName(this, 'BackupsBucket', `enabl-backups-${envName}`);

    // Knowledge base bucket - handle existing naming inconsistencies
    let knowledgeBaseBucketName: string;
    if (envName === 'dev') {
      // Check for both naming conventions
      knowledgeBaseBucketName = 'enabl-knowledge-base-development'; // Use existing development bucket
    } else {
      knowledgeBaseBucketName = `enabl-knowledge-base-${envName}`;
    }
    
    this.knowledgeBaseBucket = s3.Bucket.fromBucketName(this, 'KnowledgeBaseBucket', knowledgeBaseBucketName);

    // Ensure local knowledge-base content is uploaded to the imported bucket (dev/staging/prod)
    new s3deploy.BucketDeployment(this, 'KnowledgeBaseContentDeployment', {
      sources: [s3deploy.Source.asset('./knowledge-base')],
      destinationBucket: this.knowledgeBaseBucket,
      destinationKeyPrefix: '',
      prune: false, // don't delete unknown keys in shared buckets
    });

    // ===========================================
    // 3. IMPORT EXISTING COGNITO USER POOL
    // ===========================================
    
    const userPoolId = this.getUserPoolId(envName);
    this.userPool = cognito.UserPool.fromUserPoolId(this, 'UserPool', userPoolId);

    // Get or create user pool client
    this.userPoolClient = this.getOrCreateUserPoolClient(envName);

    // ===========================================
  // 4. CREATE NEW OPENSEARCH COLLECTION (if needed)
    // ===========================================
    
  const collectionName = `enabl-vector-${envName}`;
    
    // Create data access policy
    const dataAccessPolicy = new opensearchserverless.CfnAccessPolicy(this, 'DataAccessPolicy', {
      name: `${collectionName}-data-access`,
      type: 'data',
      policy: JSON.stringify([{
        Rules: [{
          ResourceType: 'collection',
          Resource: [`collection/${collectionName}`],
          Permission: ['aoss:*']
        }, {
          ResourceType: 'index',
          Resource: [`index/${collectionName}/*`],
          Permission: ['aoss:*']
        }],
        Principal: [`arn:aws:iam::${cdk.Aws.ACCOUNT_ID}:root`]
      }])
    });

    // Create network policy
    const networkPolicy = new opensearchserverless.CfnSecurityPolicy(this, 'NetworkPolicy', {
      name: `${collectionName}-network`,
      type: 'network',
      policy: JSON.stringify([{
        Rules: [{
          ResourceType: 'collection',
          Resource: [`collection/${collectionName}`]
        }, {
          ResourceType: 'dashboard',
          Resource: [`collection/${collectionName}`]
        }],
        AllowFromPublic: true
      }])
    });

    // Create encryption policy
    const encryptionPolicy = new opensearchserverless.CfnSecurityPolicy(this, 'EncryptionPolicy', {
      name: `${collectionName}-encryption`,
      type: 'encryption',
      policy: JSON.stringify({
        Rules: [{
          ResourceType: 'collection',
          Resource: [`collection/${collectionName}`]
        }],
        AWSOwnedKey: true
      })
    });

    // Create the collection
    this.vectorCollection = new opensearchserverless.CfnCollection(this, 'VectorCollection', {
      name: collectionName,
      type: 'VECTORSEARCH',
      description: `Vector search collection for Enabl Health ${environment} environment`,
    });

    this.vectorCollection.addDependency(dataAccessPolicy);
    this.vectorCollection.addDependency(networkPolicy);
    this.vectorCollection.addDependency(encryptionPolicy);

    // ===========================================
    // 4.a. OPENSEARCH INDEX BOOTSTRAP (ensure 'documents' index exists)
    // ===========================================
    const osIndexBootstrapFunction = new lambda.Function(this, 'OpenSearchIndexBootstrapFunction', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambda/opensearch-index-bootstrap'),
      timeout: cdk.Duration.minutes(2),
      memorySize: 256,
      functionName: `enabl-os-index-bootstrap-${envName}`,
      environment: {
        COLLECTION_ENDPOINT: this.vectorCollection.attrCollectionEndpoint,
        INDEX_NAME: 'documents',
        REGION: 'us-east-1',
      },
    });

    // Allow AOSS API access for bootstrap function
    osIndexBootstrapFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['aoss:APIAccessAll'],
      resources: ['*'],
    }));

  // ===========================================
    // 5. CREATE OR IMPORT EXISTING APIs
    // ===========================================
    
    // Try to import existing APIs or create new ones
    this.mainApi = this.getOrCreateMainApi(envName);
    this.aiApi = this.getOrCreateAiApi(envName);

    // ===========================================
    // 6. IAM ROLES AND POLICIES
    // ===========================================
    
    // Create Bedrock execution role
    const bedrockRole = new iam.Role(this, 'BedrockExecutionRole', {
      roleName: `enabl-bedrock-role-${envName}`,
      assumedBy: new iam.ServicePrincipal('bedrock.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonBedrockFullAccess'),
      ],
      inlinePolicies: {
        OpenSearchAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['aoss:*'],
              resources: [this.vectorCollection.attrArn],
            }),
          ],
        }),
        S3Access: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['s3:GetObject', 's3:PutObject'],
              resources: [`${this.knowledgeBaseBucket.bucketArn}/*`],
            }),
          ],
        }),
      },
    });

    // ===========================================
    // 6. LAMBDA FUNCTIONS & AI AGENTS
    // ===========================================

    // Chat Router Lambda Function
    const chatRouterFunction = new lambda.Function(this, 'ChatRouterFunction', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lib/lambda/chat-router'),
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      functionName: `enabl-chat-router-${envName}`, // Different name to avoid conflicts
      environment: {
        REGION: 'us-east-1',
        HEALTH_ASSISTANT_FUNCTION: `enabl-health-assistant-${envName}`,
        COMMUNITY_AGENT_FUNCTION: `enabl-community-agent-${envName}-v2`, // Use unique names
        DOCUMENT_AGENT_FUNCTION: `enabl-document-agent-${envName}`, // This is the missing one we need to create
        APPOINTMENT_AGENT_FUNCTION: `enabl-appointment-agent-${envName}`,
      },
    });

    // Document Agent Lambda Function - Enhanced with ChatGPT-level analysis
    // THIS IS THE MISSING FUNCTION THAT NEEDS TO BE CREATED
  const documentAgentFunction = new lambda.Function(this, 'DocumentAgentFunction', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lib/lambda/document-agent'),
      timeout: cdk.Duration.minutes(5), // Increased for OCR processing
      memorySize: 1024, // Increased for document analysis
      functionName: `enabl-document-agent-${envName}`, // This function doesn't exist yet!
      environment: {
        REGION: 'us-east-1',
        MODEL_ID: 'amazon.nova-pro-v1:0', // Upgraded for ChatGPT-level analysis
        DOCUMENTS_TABLE: this.documentsTable.tableName,
        DOCUMENTS_BUCKET: this.documentsBucket.bucketName,
    USER_UPLOADS_BUCKET: this.userUploadsBucket.bucketName, // Correct user uploads bucket
    // Vector search configuration
    VECTOR_COLLECTION_ENDPOINT: this.vectorCollection.attrCollectionEndpoint,
    VECTOR_INDEX: 'documents',
    VECTOR_DIM: '1536',
      },
    });

    // Community Agent Lambda Function (with unique name to avoid conflicts)
    const communityAgentFunction = new lambda.Function(this, 'CommunityAgentFunction', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lib/lambda/community-agent'),
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      functionName: `enabl-community-agent-${envName}-v2`, // Unique name to avoid conflicts
      environment: {
        REGION: 'us-east-1',
        MODEL_ID: 'amazon.nova-lite-v1:0',
      },
    });

    // Knowledge Agent Lambda Function (reads markdown from knowledge-base S3)
    const knowledgeAgentFunction = new lambda.Function(this, 'KnowledgeAgentFunction', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambda/knowledge-agent'),
      timeout: cdk.Duration.seconds(20),
      memorySize: 512,
      functionName: `enabl-knowledge-agent-${envName}`,
      environment: {
        ENVIRONMENT: environment,
        KNOWLEDGE_BUCKET: this.knowledgeBaseBucket.bucketName,
      },
    });

    knowledgeAgentFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['s3:GetObject', 's3:ListBucket'],
      resources: [
        this.knowledgeBaseBucket.bucketArn,
        `${this.knowledgeBaseBucket.bucketArn}/*`,
      ],
    }));

    // Skip creating Health Assistant and Appointment Agent since they already exist
    // We'll reference the existing ones instead

    // ===========================================
    // 6.1. IAM PERMISSIONS FOR LAMBDA FUNCTIONS
    // ===========================================

    // Import existing Lambda functions that already exist
    const existingHealthAssistant = lambda.Function.fromFunctionName(this, 'ExistingHealthAssistant', `enabl-health-assistant-${envName}`);
    const existingAppointmentAgent = lambda.Function.fromFunctionName(this, 'ExistingAppointmentAgent', `enabl-appointment-agent-${envName}`);

    // Grant chat router permission to invoke all Lambda functions (existing + new)
    chatRouterFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['lambda:InvokeFunction'],
      resources: [
        existingHealthAssistant.functionArn,
        documentAgentFunction.functionArn, // This is the NEW function we're creating
        communityAgentFunction.functionArn,
  existingAppointmentAgent.functionArn,
  knowledgeAgentFunction.functionArn,
      ],
    }));

    // Grant AI agents access to Bedrock (only for the new functions we're creating)
    [documentAgentFunction, communityAgentFunction].forEach(func => {
      func.addToRolePolicy(new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'bedrock:InvokeModel',
          'bedrock:RetrieveAndGenerate',
        ],
        resources: ['*'],
      }));
    });

    // Grant document agent access to S3 and DynamoDB
    documentAgentFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        's3:GetObject',
        's3:GetObjectVersion',
      ],
      resources: [
        `${this.documentsBucket.bucketArn}/*`,
      ],
    }));

    // Grant document agent access to user uploads bucket
    documentAgentFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        's3:GetObject',
        's3:GetObjectVersion',
        's3:ListBucket',
  's3:PutObject',
      ],
      resources: [
        `${this.userUploadsBucket.bucketArn}/*`,
        this.userUploadsBucket.bucketArn, // For ListBucket permission
      ],
    }));

    documentAgentFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'dynamodb:GetItem',
        'dynamodb:PutItem',
        'dynamodb:UpdateItem',
        'dynamodb:Query',
        'dynamodb:Scan',
      ],
      resources: [`arn:aws:dynamodb:us-east-1:*:table/${this.documentsTable.tableName}`],
    }));

    // Allow OpenSearch Serverless data plane access from the Lambda execution role
    documentAgentFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['aoss:APIAccessAll'],
      resources: ['*'],
    }));

    // Grant Textract permissions for OCR processing
    documentAgentFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'textract:DetectDocumentText',
        'textract:AnalyzeDocument',
        'textract:GetDocumentAnalysis',
        'textract:StartDocumentAnalysis',
  'textract:StartDocumentTextDetection',
  'textract:GetDocumentTextDetection',
      ],
      resources: ['*'],
    }));

    // ===========================================
    // 6.a. DOCUMENT INGEST LAMBDA (S3 -> DynamoDB)
    // ===========================================
    const documentIngestFunction = new lambda.Function(this, 'DocumentIngestFunction', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lib/lambda/document-ingest'),
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      functionName: `enabl-document-ingest-${envName}`,
      environment: {
        DOCUMENTS_TABLE: this.documentsTable.tableName,
      },
    });

    // Permissions: S3 head/get for object metadata; DynamoDB put/update
    documentIngestFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['s3:HeadObject', 's3:GetObject'],
      resources: [
        `${this.userUploadsBucket.bucketArn}/*`,
      ],
    }));
    documentIngestFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['dynamodb:PutItem', 'dynamodb:UpdateItem'],
      resources: [this.documentsTable.tableArn],
    }));

    // S3 -> Lambda notification for object created
    // Note: addEventNotification on imported buckets creates the necessary resources when permitted
    this.userUploadsBucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new s3n.LambdaDestination(documentIngestFunction)
    );

    // Note: Appointment agent permissions are already configured in the other stack

    // ===========================================
    // 6.2. API GATEWAY INTEGRATIONS
    // ===========================================

    // AI API Chat endpoint
    const chatResource = this.aiApi.root.addResource('chat');
    chatResource.addMethod('POST', new apigateway.LambdaIntegration(chatRouterFunction, {
      proxy: true,
    }));

    // ===========================================
    // 6.3. OPENSEARCH SERVERLESS DATA ACCESS POLICY FOR LAMBDA ROLE
    // ===========================================
    const vecDataPolicy = new opensearchserverless.CfnAccessPolicy(this, 'VectorDataAccessPolicy', {
      name: `${collectionName}-lambda-access`,
      type: 'data',
      policy: JSON.stringify([
        {
          Rules: [
            {
              ResourceType: 'collection',
              Resource: [`collection/${collectionName}`],
              Permission: [
                'aoss:CreateCollectionItems',
                'aoss:DeleteCollectionItems',
                'aoss:UpdateCollectionItems',
                'aoss:DescribeCollectionItems'
              ]
            },
            {
              ResourceType: 'index',
              Resource: [`index/${collectionName}/*`],
              Permission: [
                'aoss:CreateIndex',
                'aoss:DeleteIndex',
                'aoss:UpdateIndex',
                'aoss:DescribeIndex',
                'aoss:ReadDocument',
                'aoss:WriteDocument'
              ]
            }
          ],
          Principal: [
            documentAgentFunction.role!.roleArn,
            `arn:aws:sts::${this.account}:assumed-role/${documentAgentFunction.role!.roleName}/*`,
            // Also allow the bootstrap function to manage/create index
            osIndexBootstrapFunction.role!.roleArn,
            `arn:aws:sts::${this.account}:assumed-role/${osIndexBootstrapFunction.role!.roleName}/*`
          ]
        }
      ])
    });
    vecDataPolicy.addDependency(this.vectorCollection);

    // Provider + Custom Resource to ensure index exists after policies/collection are ready
    const osIndexProvider = new cr.Provider(this, 'OpenSearchIndexProvider', {
      onEventHandler: osIndexBootstrapFunction,
    });

    const ensureDocumentsIndex = new cdk.CustomResource(this, 'EnsureDocumentsIndex', {
      serviceToken: osIndexProvider.serviceToken,
      properties: {
        CollectionEndpoint: this.vectorCollection.attrCollectionEndpoint,
        IndexName: 'documents',
      },
    });
    ensureDocumentsIndex.node.addDependency(this.vectorCollection);
    ensureDocumentsIndex.node.addDependency(vecDataPolicy);

    // ===========================================
    // 7. OUTPUTS
    // ===========================================
    
    new cdk.CfnOutput(this, 'UserPoolId', {
      value: this.userPool.userPoolId,
      description: 'Cognito User Pool ID',
    });

    new cdk.CfnOutput(this, 'UserPoolClientId', {
      value: this.userPoolClient.userPoolClientId,
      description: 'Cognito User Pool Client ID',
    });

    new cdk.CfnOutput(this, 'VectorCollectionEndpoint', {
      value: this.vectorCollection.attrCollectionEndpoint,
      description: 'OpenSearch Serverless Collection Endpoint',
    });

    new cdk.CfnOutput(this, 'DocumentsBucketName', {
      value: this.documentsBucket.bucketName,
      description: 'Documents S3 Bucket Name',
    });

    new cdk.CfnOutput(this, 'KnowledgeBaseBucketName', {
      value: this.knowledgeBaseBucket.bucketName,
      description: 'Knowledge Base S3 Bucket Name',
    });
  }

  // Helper methods
  private getEnvironmentName(environment: string): string {
    const envMap: { [key: string]: string } = {
      'development': 'dev',
      'staging': 'staging',
      'production': 'prod'
    };
    return envMap[environment] || environment;
  }

  private getChatTableName(envName: string): string {
    // Check which chat table naming convention exists
    if (envName === 'dev') {
      return 'enabl-chat-dev'; // Original naming
    }
    return `enabl-chat-${envName}`;
  }

  private getUserPoolId(envName: string): string {
    const poolMap: { [key: string]: string } = {
      'dev': 'us-east-1_lBBFpwOnU',
      'staging': 'us-east-1_ex9P9pFRA',
      'prod': 'us-east-1_fUHVuOW4f'
    };
    return poolMap[envName];
  }

  private getOrCreateUserPoolClient(envName: string): cognito.UserPoolClient {
    // For now, create a new client - we can import existing ones later
    return new cognito.UserPoolClient(this, 'UserPoolClient', {
      userPool: this.userPool,
      userPoolClientName: `enabl-client-${envName}`,
      generateSecret: false,
      authFlows: {
        userPassword: true,
        userSrp: true,
      },
      oAuth: {
        flows: {
          authorizationCodeGrant: true,
        },
        scopes: [cognito.OAuthScope.OPENID, cognito.OAuthScope.PROFILE, cognito.OAuthScope.EMAIL],
        callbackUrls: [`https://${envName === 'prod' ? '' : envName + '.'}enabl.health/api/auth/callback/cognito`],
      },
    });
  }

  private getOrCreateMainApi(envName: string): apigateway.IRestApi {
    // Create new main API for this environment
    return new apigateway.RestApi(this, 'MainApi', {
      restApiName: `enabl-api-${envName}-import`,
      description: `Main API for Enabl Health ${envName} environment (import)`,
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'X-Amz-Date', 'Authorization', 'X-Api-Key'],
      },
    });
  }

  private getOrCreateAiApi(envName: string): apigateway.IRestApi {
    // Import existing AI API based on environment with root resource ID
    const apiMap: { [key: string]: { id: string, rootResourceId: string } } = {
      'dev': { id: 'uk27my6lo0', rootResourceId: 'unknown' }, // enabl-ai-api-development
      'staging': { id: 'rs9kwccdr9', rootResourceId: 'unknown' }, // enabl-ai-api-staging
      'prod': { id: 'tj9g13ykme', rootResourceId: 'unknown' } // enabl-ai-api-production
    };
    
    const apiInfo = apiMap[envName];
    if (apiInfo) {
      // For now, create a new API since we need the root resource for adding methods
      // We can import later once we have the root resource IDs
      return new apigateway.RestApi(this, 'AiApi', {
        restApiName: `enabl-ai-api-${envName}-import`,
        description: `AI API for Enabl Health ${envName} environment (import)`,
        defaultCorsPreflightOptions: {
          allowOrigins: apigateway.Cors.ALL_ORIGINS,
          allowMethods: apigateway.Cors.ALL_METHODS,
          allowHeaders: ['Content-Type', 'X-Amz-Date', 'Authorization', 'X-Api-Key'],
        },
      });
    }
    
    // Create new API if not found
    return new apigateway.RestApi(this, 'AiApi', {
      restApiName: `enabl-ai-api-${envName}`,
      description: `AI API for Enabl Health ${envName} environment`,
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'X-Amz-Date', 'Authorization', 'X-Api-Key'],
      },
    });
  }
}
