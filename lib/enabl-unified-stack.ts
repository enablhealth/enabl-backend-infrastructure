import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as opensearchserverless from 'aws-cdk-lib/aws-opensearchserverless';
import * as bedrock from 'aws-cdk-lib/aws-bedrock';
import { EnablConfig } from './config';

export interface EnablUnifiedStackProps extends cdk.StackProps {
  config: EnablConfig;
  environment: string;
}

export class EnablUnifiedStack extends cdk.Stack {
  // Core Services
  public readonly userTable: dynamodb.Table;
  public readonly chatTable: dynamodb.Table;
  public readonly documentsTable: dynamodb.Table;
  public readonly appointmentsTable: dynamodb.Table;
  
  // Storage
  public readonly documentsBucket: s3.Bucket;
  public readonly knowledgeBaseBucket: s3.Bucket;
  
  // Authentication
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;
  
  // Vector Search & AI
  public readonly vectorCollection: opensearchserverless.CfnCollection;
  // public readonly knowledgeBase: bedrock.CfnKnowledgeBase; // Will be created manually
  
  // APIs
  public readonly mainApi: apigateway.RestApi;
  public readonly aiApi: apigateway.RestApi;

  constructor(scope: Construct, id: string, props: EnablUnifiedStackProps) {
    super(scope, id, props);

    const { config, environment } = props;

    // ===========================================
    // 1. CORE DATA STORAGE
    // ===========================================
    
    this.userTable = new dynamodb.Table(this, 'UsersTable', {
      tableName: `enabl-users-${environment}`,
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      billingMode: environment === 'production' 
        ? dynamodb.BillingMode.PROVISIONED 
        : dynamodb.BillingMode.PAY_PER_REQUEST,
      ...(environment === 'production' && {
        readCapacity: 5,
        writeCapacity: 5,
      }),
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: environment === 'production'
      },
      removalPolicy: environment === 'production' 
        ? cdk.RemovalPolicy.RETAIN 
        : cdk.RemovalPolicy.DESTROY,
    });

    this.chatTable = new dynamodb.Table(this, 'ChatHistoryTable', {
      tableName: `enabl-chat-history-${environment}`,
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'chatId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: environment === 'production' 
        ? cdk.RemovalPolicy.RETAIN 
        : cdk.RemovalPolicy.DESTROY,
    });

    this.documentsTable = new dynamodb.Table(this, 'DocumentsTable', {
      tableName: `enabl-documents-${environment}`,
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'documentId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: environment === 'production' 
        ? cdk.RemovalPolicy.RETAIN 
        : cdk.RemovalPolicy.DESTROY,
    });

    this.appointmentsTable = new dynamodb.Table(this, 'AppointmentsTable', {
      tableName: `enabl-appointments-${environment}`,
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'appointmentId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: environment === 'production' 
        ? cdk.RemovalPolicy.RETAIN 
        : cdk.RemovalPolicy.DESTROY,
    });

    // ===========================================
    // 2. STORAGE BUCKETS
    // ===========================================

    this.documentsBucket = new s3.Bucket(this, 'DocumentsBucket', {
      bucketName: `enabl-documents-${environment}-${this.account}`,
      cors: [{
        allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.POST, s3.HttpMethods.PUT, s3.HttpMethods.DELETE],
        allowedOrigins: ['*'],
        allowedHeaders: ['*'],
      }],
      removalPolicy: environment === 'production' 
        ? cdk.RemovalPolicy.RETAIN 
        : cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: environment !== 'production',
    });

    this.knowledgeBaseBucket = new s3.Bucket(this, 'KnowledgeBaseBucket', {
      bucketName: `enabl-knowledge-base-${environment}-${this.account}`,
      removalPolicy: environment === 'production' 
        ? cdk.RemovalPolicy.RETAIN 
        : cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: environment !== 'production',
    });

    // ===========================================
    // 3. AUTHENTICATION
    // ===========================================

    this.userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: `enabl-users-${environment}`,
      selfSignUpEnabled: true,
      userVerification: {
        emailSubject: 'Verify your email for Enabl Health',
        emailBody: 'Hello {username}, Thanks for signing up to Enabl Health! Your verification code is {####}',
        emailStyle: cognito.VerificationEmailStyle.CODE,
      },
      signInAliases: {
        email: true,
      },
      autoVerify: {
        email: true,
      },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: false,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
    });

    this.userPoolClient = new cognito.UserPoolClient(this, 'UserPoolClient', {
      userPool: this.userPool,
      userPoolClientName: `enabl-client-${environment}`,
      generateSecret: false,
      authFlows: {
        userSrp: true,
      },
      oAuth: {
        callbackUrls: config.cognito.oauth.callbackUrls,
        logoutUrls: config.cognito.oauth.logoutUrls,
        flows: {
          authorizationCodeGrant: true,
        },
        scopes: [
          cognito.OAuthScope.EMAIL,
          cognito.OAuthScope.OPENID,
          cognito.OAuthScope.PROFILE,
        ],
      },
    });

    // ===========================================
    // 4. VECTOR SEARCH (OpenSearch Serverless)
    // ===========================================

    // Security policy for OpenSearch Serverless
    const securityPolicy = new opensearchserverless.CfnSecurityPolicy(this, 'VectorSecurityPolicy', {
      name: `enabl-sec-${environment}`, // Shortened to meet 32 char limit
      type: 'encryption',
      policy: JSON.stringify({
        Rules: [
          {
            ResourceType: 'collection',
            Resource: [`collection/enabl-vec-${environment}`] // Shortened collection name
          }
        ],
        AWSOwnedKey: true
      })
    });

    // Network policy for OpenSearch Serverless
    const networkPolicy = new opensearchserverless.CfnSecurityPolicy(this, 'VectorNetworkPolicy', {
      name: `enabl-net-${environment}`, // Shortened to meet 32 char limit
      type: 'network',
      policy: JSON.stringify([
        {
          Rules: [
            {
              ResourceType: 'collection',
              Resource: [`collection/enabl-vec-${environment}`] // Shortened collection name
            },
            {
              ResourceType: 'dashboard',
              Resource: [`collection/enabl-vec-${environment}`] // Shortened collection name
            }
          ],
          AllowFromPublic: true
        }
      ])
    });

    // Vector collection
    this.vectorCollection = new opensearchserverless.CfnCollection(this, 'VectorCollection', {
      name: `enabl-vec-${environment}`, // Shortened to meet naming requirements
      type: 'VECTORSEARCH',
      description: `Enabl Health vector search collection for ${environment}`,
    });

    this.vectorCollection.addDependency(securityPolicy);
    this.vectorCollection.addDependency(networkPolicy);

    // ===========================================
    // 5. BEDROCK KNOWLEDGE BASE (Manual Setup Required)
    // ===========================================
    
    // Note: Bedrock Knowledge Base requires manual index creation in OpenSearch
    // This will be created via Lambda function or manual process after stack deployment
    
    // IAM role for future Bedrock Knowledge Base
    const knowledgeBaseRole = new iam.Role(this, 'KnowledgeBaseRole', {
      assumedBy: new iam.ServicePrincipal('bedrock.amazonaws.com'),
      description: 'Role for Bedrock Knowledge Base to access S3 and OpenSearch',
      inlinePolicies: {
        BedrockKnowledgeBasePolicy: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                's3:GetObject',
                's3:ListBucket',
              ],
              resources: [
                this.knowledgeBaseBucket.bucketArn,
                `${this.knowledgeBaseBucket.bucketArn}/*`,
              ],
            }),
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'aoss:APIAccessAll',
              ],
              resources: [this.vectorCollection.attrArn],
            }),
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'bedrock:InvokeModel',
              ],
              resources: ['*'],
            }),
          ],
        }),
      },
    });

    // Output the role ARN for manual Knowledge Base creation
    new cdk.CfnOutput(this, 'KnowledgeBaseRoleArn', {
      value: knowledgeBaseRole.roleArn,
      description: 'IAM Role ARN for Bedrock Knowledge Base (for manual setup)',
      exportName: `EnablKnowledgeBaseRoleArn-${environment}`,
    });

    // ===========================================
    // 6. API GATEWAYS
    // ===========================================

    // Main API for standard operations
    this.mainApi = new apigateway.RestApi(this, 'MainApi', {
      restApiName: `enabl-api-${environment}`,
      description: `Enabl Health Main API (${environment})`,
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'X-Amz-Date', 'Authorization', 'X-Api-Key'],
      },
    });

    // AI API for Bedrock operations
    this.aiApi = new apigateway.RestApi(this, 'AiApi', {
      restApiName: `enabl-ai-api-${environment}`,
      description: `Enabl Health AI API (${environment})`,
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'X-Amz-Date', 'Authorization', 'X-Api-Key'],
      },
    });

    // ===========================================
    // 7. LAMBDA FUNCTIONS & AI AGENTS
    // ===========================================

    // Chat Router Lambda Function
    const chatRouterFunction = new lambda.Function(this, 'ChatRouterFunction', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lib/lambda/chat-router'),
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      environment: {
        REGION: config.region,
        HEALTH_ASSISTANT_FUNCTION: `enabl-health-assistant-${environment}`,
        COMMUNITY_AGENT_FUNCTION: `enabl-community-agent-${environment}`,
        DOCUMENT_AGENT_FUNCTION: `enabl-document-agent-${environment}`,
        APPOINTMENT_AGENT_FUNCTION: `enabl-appointment-agent-${environment}`,
      },
    });

    // Health Assistant Lambda Function
    const healthAssistantFunction = new lambda.Function(this, 'HealthAssistantFunction', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lib/lambda/health-assistant'),
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      functionName: `enabl-health-assistant-${environment}`,
      environment: {
        REGION: config.region,
        MODEL_ID: 'amazon.nova-pro-v1:0',
      },
    });

    // Document Agent Lambda Function - Enhanced with ChatGPT-level analysis
  const documentAgentFunction = new lambda.Function(this, 'DocumentAgentFunction', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lib/lambda/document-agent'),
      timeout: cdk.Duration.minutes(5), // Increased for OCR processing
      memorySize: 1024, // Increased for document analysis
      functionName: `enabl-document-agent-${environment}`,
      environment: {
        REGION: config.region,
        MODEL_ID: 'amazon.nova-pro-v1:0', // Upgraded for ChatGPT-level analysis
    // Use configured names to avoid env suffix drift
    DOCUMENTS_TABLE: config.dynamodb.tables.documents,
    DOCUMENTS_BUCKET: config.s3.buckets.documents,
    USER_UPLOADS_BUCKET: config.s3.buckets.userUploads,
  // Vector search configuration for RAG
  VECTOR_COLLECTION_ENDPOINT: this.vectorCollection.attrCollectionEndpoint,
  VECTOR_INDEX: 'documents',
  VECTOR_DIM: '1536',
      },
    });

    // Community Agent Lambda Function
    const communityAgentFunction = new lambda.Function(this, 'CommunityAgentFunction', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lib/lambda/community-agent'),
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      functionName: `enabl-community-agent-${environment}`,
      environment: {
        REGION: config.region,
        MODEL_ID: 'amazon.nova-lite-v1:0',
      },
    });

    // Appointment Agent Lambda Function
    const appointmentAgentFunction = new lambda.Function(this, 'AppointmentAgentFunction', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lib/lambda/appointment-agent'),
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      functionName: `enabl-appointment-agent-${environment}`,
      environment: {
        REGION: config.region,
        MODEL_ID: 'amazon.nova-lite-v1:0',
        APPOINTMENTS_TABLE: this.appointmentsTable.tableName,
      },
    });

    // ===========================================
    // 8. IAM PERMISSIONS FOR LAMBDA FUNCTIONS
    // ===========================================

    // Grant chat router permission to invoke other Lambda functions
    chatRouterFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['lambda:InvokeFunction'],
      resources: [
        healthAssistantFunction.functionArn,
        documentAgentFunction.functionArn,
        communityAgentFunction.functionArn,
        appointmentAgentFunction.functionArn,
      ],
    }));

    // Grant all AI agents access to Bedrock
    [healthAssistantFunction, documentAgentFunction, communityAgentFunction, appointmentAgentFunction].forEach(func => {
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
        's3:ListBucket',
      ],
      resources: [
        `${this.documentsBucket.bucketArn}/*`,
        this.documentsBucket.bucketArn,
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
  'arn:aws:s3:::enabl-user-uploads-dev/*',
  'arn:aws:s3:::enabl-user-uploads-dev',
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
      resources: [this.documentsTable.tableArn],
    }));

    // Allow OpenSearch Serverless data plane access (control plane auth + data policy below)
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

    // Grant appointment agent access to DynamoDB
    appointmentAgentFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'dynamodb:GetItem',
        'dynamodb:PutItem',
        'dynamodb:UpdateItem',
        'dynamodb:Query',
        'dynamodb:Scan',
      ],
      resources: [this.appointmentsTable.tableArn],
    }));

    // ===========================================
    // 9. API GATEWAY INTEGRATIONS
    // ===========================================

    // AI API Chat endpoint
    const chatResource = this.aiApi.root.addResource('chat');
    chatResource.addMethod('POST', new apigateway.LambdaIntegration(chatRouterFunction, {
      proxy: true,
    }));

    // ===========================================
    // 9.1 OPENSEARCH SERVERLESS DATA ACCESS POLICY
    // ===========================================
    // Grant the document agent role data-plane access to the vector collection and indexes
    const vectorDataAccessPolicy = new opensearchserverless.CfnAccessPolicy(this, 'VectorDataAccessPolicy', {
      name: `enabl-vec-data-${environment}`,
      type: 'data',
      policy: cdk.Stack.of(this).toJsonString([
        {
          Rules: [
            {
              Resource: [`collection/enabl-vec-${environment}`],
              Permission: [
                'aoss:CreateCollectionItems',
                'aoss:DeleteCollectionItems',
                'aoss:UpdateCollectionItems',
                'aoss:DescribeCollectionItems'
              ],
              ResourceType: 'collection'
            },
            {
              Resource: [`index/enabl-vec-${environment}/*`],
              Permission: [
                'aoss:CreateIndex',
                'aoss:DeleteIndex',
                'aoss:UpdateIndex',
                'aoss:DescribeIndex',
                'aoss:ReadDocument',
                'aoss:WriteDocument'
              ],
              ResourceType: 'index'
            }
          ],
          Principal: [
            documentAgentFunction.role!.roleArn,
            `arn:aws:sts::${this.account}:assumed-role/${documentAgentFunction.role!.roleName}/*`
          ]
        }
      ])
    });
    vectorDataAccessPolicy.addDependency(this.vectorCollection);

    // ===========================================
    // 10. OUTPUTS
    // ===========================================

    new cdk.CfnOutput(this, 'UserPoolId', {
      value: this.userPool.userPoolId,
      description: 'Cognito User Pool ID',
      exportName: `EnablUserPoolId-${environment}`,
    });

    new cdk.CfnOutput(this, 'UserPoolClientId', {
      value: this.userPoolClient.userPoolClientId,
      description: 'Cognito User Pool Client ID',
      exportName: `EnablUserPoolClientId-${environment}`,
    });

    new cdk.CfnOutput(this, 'MainApiEndpoint', {
      value: this.mainApi.url,
      description: 'Main API Gateway endpoint',
      exportName: `EnablMainApiEndpoint-${environment}`,
    });

    new cdk.CfnOutput(this, 'AiApiEndpoint', {
      value: this.aiApi.url,
      description: 'AI API Gateway endpoint',
      exportName: `EnablAiApiEndpoint-${environment}`,
    });

    new cdk.CfnOutput(this, 'VectorCollectionEndpoint', {
      value: this.vectorCollection.attrCollectionEndpoint,
      description: 'OpenSearch Serverless collection endpoint',
      exportName: `EnablVectorCollectionEndpoint-${environment}`,
    });

    new cdk.CfnOutput(this, 'DocumentsBucketName', {
      value: this.documentsBucket.bucketName,
      description: 'S3 bucket for user documents',
      exportName: `EnablDocumentsBucket-${environment}`,
    });

    new cdk.CfnOutput(this, 'KnowledgeBaseBucketName', {
      value: this.knowledgeBaseBucket.bucketName,
      description: 'S3 bucket for knowledge base documents',
      exportName: `EnablKnowledgeBaseBucket-${environment}`,
    });
  }
}
