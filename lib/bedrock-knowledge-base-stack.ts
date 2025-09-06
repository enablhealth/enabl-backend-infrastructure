import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';

export interface BedrockKnowledgeBaseStackProps extends cdk.StackProps {
  environment: string;
  openSearchCollectionArn: string;
  openSearchCollectionEndpoint: string;
}

export class BedrockKnowledgeBaseStack extends cdk.Stack {
  public readonly knowledgeBaseRole: iam.Role;
  public readonly knowledgeBaseBucket: s3.Bucket;
  public readonly vectorProcessorLambda: lambda.Function;

  constructor(scope: Construct, id: string, props: BedrockKnowledgeBaseStackProps) {
    super(scope, id, props);

    const { environment, openSearchCollectionArn, openSearchCollectionEndpoint } = props;

    // S3 bucket for knowledge base documents
    this.knowledgeBaseBucket = new s3.Bucket(this, 'KnowledgeBaseBucket', {
      bucketName: `enabl-knowledge-base-${environment}-${this.account}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      versioned: environment === 'production',
      lifecycleRules: [{
        id: 'DeleteIncompleteMultipartUploads',
        abortIncompleteMultipartUploadAfter: cdk.Duration.days(7)
      }],
      removalPolicy: environment === 'development' ? cdk.RemovalPolicy.DESTROY : cdk.RemovalPolicy.RETAIN
    });

    // IAM role for Bedrock Knowledge Base
    this.knowledgeBaseRole = new iam.Role(this, 'KnowledgeBaseRole', {
      roleName: `enabl-bedrock-kb-role-${environment}`,
      assumedBy: new iam.ServicePrincipal('bedrock.amazonaws.com'),
      inlinePolicies: {
        KnowledgeBasePolicy: new iam.PolicyDocument({
          statements: [
            // S3 permissions
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                's3:GetObject',
                's3:ListBucket'
              ],
              resources: [
                this.knowledgeBaseBucket.bucketArn,
                `${this.knowledgeBaseBucket.bucketArn}/*`
              ]
            }),
            // OpenSearch permissions
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'aoss:APIAccessAll'
              ],
              resources: [openSearchCollectionArn]
            }),
            // Bedrock model permissions
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'bedrock:InvokeModel'
              ],
              resources: [
                `arn:aws:bedrock:${this.region}::foundation-model/amazon.titan-embed-text-v1`,
                `arn:aws:bedrock:${this.region}::foundation-model/amazon.nova-pro-v1:0`
              ]
            })
          ]
        })
      }
    });

    // Lambda execution role for vector processing
    const vectorProcessorRole = new iam.Role(this, 'VectorProcessorRole', {
      roleName: `enabl-vector-processor-role-${environment}`,
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')
      ],
      inlinePolicies: {
        VectorProcessorPolicy: new iam.PolicyDocument({
          statements: [
            // S3 permissions for documents and knowledge base
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                's3:GetObject',
                's3:PutObject',
                's3:ListBucket'
              ],
              resources: [
                this.knowledgeBaseBucket.bucketArn,
                `${this.knowledgeBaseBucket.bucketArn}/*`,
                `arn:aws:s3:::enabl-documents-${environment}-*`,
                `arn:aws:s3:::enabl-documents-${environment}-*/*`
              ]
            }),
            // OpenSearch permissions
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'aoss:APIAccessAll'
              ],
              resources: [openSearchCollectionArn]
            }),
            // Bedrock permissions
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'bedrock:InvokeModel',
                'bedrock-agent:CreateKnowledgeBase',
                'bedrock-agent:CreateDataSource',
                'bedrock-agent:StartIngestionJob',
                'bedrock-agent:GetKnowledgeBase',
                'bedrock-agent:GetDataSource'
              ],
              resources: ['*']
            }),
            // DynamoDB permissions
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'dynamodb:GetItem',
                'dynamodb:PutItem',
                'dynamodb:UpdateItem',
                'dynamodb:Query'
              ],
              resources: [
                `arn:aws:dynamodb:${this.region}:${this.account}:table/enabl-user-knowledge-bases-${environment}`
              ]
            }),
            // IAM PassRole for Bedrock
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['iam:PassRole'],
              resources: [this.knowledgeBaseRole.roleArn]
            })
          ]
        })
      }
    });

    // Lambda function for vector document processing
    this.vectorProcessorLambda = new lambda.Function(this, 'VectorProcessorLambda', {
      functionName: `enabl-vector-processor-${environment}`,
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromInline(`
        const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
        const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
        
        const dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION });
        const docClient = DynamoDBDocumentClient.from(dynamoClient);
        
        exports.handler = async (event) => {
          console.log('Vector processor triggered:', JSON.stringify(event, null, 2));
          
          // This is a placeholder - the actual processing logic will be implemented
          // in the vectorDocumentProcessor service
          
          return {
            statusCode: 200,
            body: JSON.stringify({
              message: 'Vector processing completed',
              event
            })
          };
        };
      `),
      role: vectorProcessorRole,
      timeout: cdk.Duration.minutes(15),
      memorySize: 1024,
      environment: {
        OPENSEARCH_COLLECTION_ENDPOINT: openSearchCollectionEndpoint,
        OPENSEARCH_COLLECTION_ARN: openSearchCollectionArn,
        KNOWLEDGE_BASE_BUCKET: this.knowledgeBaseBucket.bucketName,
        KNOWLEDGE_BASE_ROLE_ARN: this.knowledgeBaseRole.roleArn,
        DYNAMODB_USER_KNOWLEDGE_BASES_TABLE: `enabl-user-knowledge-bases-${environment}`,
        ENVIRONMENT: environment
      }
    });

    // S3 event trigger for automatic document processing
    this.knowledgeBaseBucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new cdk.aws_s3_notifications.LambdaDestination(this.vectorProcessorLambda),
      { prefix: 'users/', suffix: '.txt' }
    );

    // Output the resources
    new cdk.CfnOutput(this, 'KnowledgeBaseBucketName', {
      value: this.knowledgeBaseBucket.bucketName,
      description: 'S3 bucket for knowledge base documents',
      exportName: `enabl-kb-bucket-${environment}`
    });

    new cdk.CfnOutput(this, 'KnowledgeBaseRoleArn', {
      value: this.knowledgeBaseRole.roleArn,
      description: 'IAM role for Bedrock Knowledge Base',
      exportName: `enabl-kb-role-arn-${environment}`
    });

    new cdk.CfnOutput(this, 'VectorProcessorLambdaArn', {
      value: this.vectorProcessorLambda.functionArn,
      description: 'Lambda function for vector document processing',
      exportName: `enabl-vector-processor-arn-${environment}`
    });

    new cdk.CfnOutput(this, 'VectorProcessorLambdaName', {
      value: this.vectorProcessorLambda.functionName,
      description: 'Lambda function name for vector document processing',
      exportName: `enabl-vector-processor-name-${environment}`
    });
  }
}
