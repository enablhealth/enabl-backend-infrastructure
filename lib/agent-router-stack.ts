import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';

/**
 * Enabl Health Agent Router CDK Stack
 * Deploys the intelligent agent routing system for Bedrock AgentCore
 */
export class EnablAgentRouterStack extends cdk.Stack {
  public readonly agentRouterFunction: lambda.Function;
  public readonly apiGateway: apigateway.RestApi;
  public readonly conversationTable: dynamodb.Table;

  constructor(scope: Construct, id: string, props?: cdk.StackProps & { environment: string }) {
    super(scope, id, props);

    const environment = props?.environment || 'development';

    // DynamoDB table for conversation memory
    this.conversationTable = new dynamodb.Table(this, 'ConversationTable', {
      tableName: `enabl-conversations-${environment}`,
      partitionKey: { name: 'session_id', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'message_id', type: dynamodb.AttributeType.STRING },
      timeToLiveAttribute: 'ttl',
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: true,
      removalPolicy: environment === 'production' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY
    });

    // Add GSI for querying by user_id for recent chats
    this.conversationTable.addGlobalSecondaryIndex({
      indexName: 'UserIdIndex',
      partitionKey: { name: 'user_id', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL
    });

    // IAM Role for Lambda to invoke Bedrock agents and access DynamoDB
    const agentRouterRole = new iam.Role(this, 'AgentRouterRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
      inlinePolicies: {
        BedrockInvokePolicy: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'bedrock:InvokeModel'
              ],
              resources: [
                'arn:aws:bedrock:us-east-1::foundation-model/amazon.nova-pro-v1:0',
                'arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-*',
                'arn:aws:bedrock:us-east-1::foundation-model/amazon.titan-*'
              ]
            }),
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'bedrock-agent-runtime:InvokeAgent',
                'bedrock-agentcore:InvokeAgentRuntime',
                'bedrock-agentcore:GetAgentRuntime',
                'bedrock-agentcore:ListAgentRuntimes'
              ],
              resources: [
                'arn:aws:bedrock-agentcore:us-east-1:*:runtime/*',
                'arn:aws:bedrock-agent:us-east-1:*:agent/*',
                'arn:aws:bedrock-agent:us-east-1:*:agent-alias/*'
              ]
            }),
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'dynamodb:GetItem',
                'dynamodb:PutItem',
                'dynamodb:Query',
                'dynamodb:UpdateItem',
                'dynamodb:DeleteItem'
              ],
              resources: [this.conversationTable.tableArn]
            })
          ]
        })
      }
    });

    // Agent Router Lambda Function (Python)
    this.agentRouterFunction = new lambda.Function(this, 'AgentRouterFunction', {
      runtime: lambda.Runtime.PYTHON_3_11,
      handler: 'agent_router.lambda_handler',
      code: lambda.Code.fromAsset('lambda/agent-router', {
        exclude: ['*.ts', '*.js', 'node_modules', 'dist', 'tsconfig.json', 'package*.json']
      }),
      role: agentRouterRole,
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      environment: {
        REGION: 'us-east-1',
        PYTHONPATH: '/var/runtime:/var/task',
        CONVERSATION_TABLE: this.conversationTable.tableName,
        ENVIRONMENT: environment
      },
      description: 'Enabl Health AI Agent Router - Routes requests to specialized Bedrock agents (Python)'
    });

    // API Gateway for Agent Router
    this.apiGateway = new apigateway.RestApi(this, 'AgentRouterApi', {
      restApiName: 'Enabl Agent Router API',
      description: 'API Gateway for Enabl Health AI Agent Router',
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'Authorization', 'X-Amz-Date', 'X-Api-Key']
      }
    });

    // Lambda integration
    const agentIntegration = new apigateway.LambdaIntegration(this.agentRouterFunction, {
      requestTemplates: { 'application/json': '{ "statusCode": "200" }' }
    });

    // API Routes
    const agents = this.apiGateway.root.addResource('agents');
    
    // POST /agents - Route message to appropriate agent
    agents.addMethod('POST', agentIntegration);
    
    // GET /agents - Get available agents
    const getAgentsFunction = new lambda.Function(this, 'GetAgentsFunction', {
      runtime: lambda.Runtime.PYTHON_3_11,
      handler: 'agent_router.get_agents_handler',
      code: lambda.Code.fromAsset('lambda/agent-router', {
        exclude: ['*.ts', '*.js', 'node_modules', 'dist', 'tsconfig.json', 'package*.json']
      }),
      timeout: cdk.Duration.seconds(10),
      environment: {
        CONVERSATION_TABLE: this.conversationTable.tableName,
        ENVIRONMENT: environment
      },
      description: 'Get available Enabl Health AI agents (Python)'
    });
    
    agents.addMethod('GET', new apigateway.LambdaIntegration(getAgentsFunction));

    // Recent chats endpoints
    const chats = this.apiGateway.root.addResource('chats');
    
    // GET /chats/recent?userId=xxx - Get recent chat sessions for user
    const recentChats = chats.addResource('recent');
    const getRecentChatsFunction = new lambda.Function(this, 'GetRecentChatsFunction', {
      runtime: lambda.Runtime.PYTHON_3_11,
      handler: 'agent_router.get_recent_chats_handler',
      code: lambda.Code.fromAsset('lambda/agent-router', {
        exclude: ['*.ts', '*.js', 'node_modules', 'dist', 'tsconfig.json', 'package*.json']
      }),
      timeout: cdk.Duration.seconds(15),
      environment: {
        CONVERSATION_TABLE: this.conversationTable.tableName,
        ENVIRONMENT: environment
      },
      description: 'Get recent chat sessions for a user (Python)'
    });
    
    // Grant DynamoDB permissions to recent chats function
    this.conversationTable.grantReadData(getRecentChatsFunction);
    
    recentChats.addMethod('GET', new apigateway.LambdaIntegration(getRecentChatsFunction));

    // GET /chats/{sessionId}?userId=xxx - Get full conversation
    const sessionResource = chats.addResource('{sessionId}');
    const getConversationFunction = new lambda.Function(this, 'GetConversationFunction', {
      runtime: lambda.Runtime.PYTHON_3_11,
      handler: 'agent_router.get_conversation_handler',
      code: lambda.Code.fromAsset('lambda/agent-router', {
        exclude: ['*.ts', '*.js', 'node_modules', 'dist', 'tsconfig.json', 'package*.json']
      }),
      timeout: cdk.Duration.seconds(15),
      environment: {
        CONVERSATION_TABLE: this.conversationTable.tableName,
        ENVIRONMENT: environment
      },
      description: 'Get full conversation for a session (Python)'
    });
    
    // Grant DynamoDB permissions to conversation function
    this.conversationTable.grantReadData(getConversationFunction);
    
    sessionResource.addMethod('GET', new apigateway.LambdaIntegration(getConversationFunction));

    // Health check endpoint
    const health = this.apiGateway.root.addResource('health');
    const healthCheckFunction = new lambda.Function(this, 'HealthCheckFunction', {
      runtime: lambda.Runtime.PYTHON_3_11,
      handler: 'agent_router.health_check_handler',
      code: lambda.Code.fromAsset('lambda/agent-router', {
        exclude: ['*.ts', '*.js', 'node_modules', 'dist', 'tsconfig.json', 'package*.json']
      }),
      timeout: cdk.Duration.seconds(5),
      environment: {
        CONVERSATION_TABLE: this.conversationTable.tableName,
        ENVIRONMENT: environment
      },
      description: 'Health check for Enabl Agent Router (Python)'
    });
    
    health.addMethod('GET', new apigateway.LambdaIntegration(healthCheckFunction));

    // Outputs
    new cdk.CfnOutput(this, 'AgentRouterApiUrl', {
      value: this.apiGateway.url,
      description: 'Enabl Agent Router API Gateway URL'
    });

    new cdk.CfnOutput(this, 'AgentRouterFunctionArn', {
      value: this.agentRouterFunction.functionArn,
      description: 'Enabl Agent Router Lambda Function ARN'
    });

    new cdk.CfnOutput(this, 'ConversationTableName', {
      value: this.conversationTable.tableName,
      description: 'DynamoDB table for conversation memory'
    });

    // Tags
    cdk.Tags.of(this).add('Project', 'Enabl Health');
    cdk.Tags.of(this).add('Component', 'Agent Router');
    cdk.Tags.of(this).add('Environment', environment);
  }
}
