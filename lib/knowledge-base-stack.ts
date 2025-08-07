import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as bedrock from 'aws-cdk-lib/aws-bedrock';
import { Construct } from 'constructs';

export interface KnowledgeBaseStackProps extends cdk.StackProps {
  environment: string;
}

/**
 * Enabl Health Knowledge Base Stack
 * Creates S3 bucket and Bedrock Knowledge Base for RAG capabilities
 */
export class KnowledgeBaseStack extends cdk.Stack {
  public readonly knowledgeBucket: s3.Bucket;
  public readonly knowledgeBase: bedrock.CfnKnowledgeBase;
  public readonly knowledgeBaseId: string;

  constructor(scope: Construct, id: string, props: KnowledgeBaseStackProps) {
    super(scope, id, props);

    const { environment } = props;

    // S3 Bucket for Knowledge Base documents
    this.knowledgeBucket = new s3.Bucket(this, 'KnowledgeBucket', {
      bucketName: `enabl-global-health-kb-${environment}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      versioned: true,
      lifecycleRules: [{
        id: 'DeleteOldVersions',
        expiration: cdk.Duration.days(365),
        noncurrentVersionExpiration: cdk.Duration.days(90),
        enabled: true
      }],
      removalPolicy: environment === 'production' 
        ? cdk.RemovalPolicy.RETAIN 
        : cdk.RemovalPolicy.DESTROY
    });

    // Deploy knowledge base files from local folder to S3
    new s3deploy.BucketDeployment(this, 'KnowledgeBaseDeployment', {
      sources: [s3deploy.Source.asset('./knowledge-base')],
      destinationBucket: this.knowledgeBucket,
      destinationKeyPrefix: '',
      prune: false, // Don't delete files not in source
      retainOnDelete: environment === 'production'
    });

    // IAM Role for Bedrock Knowledge Base
    const knowledgeBaseRole = new iam.Role(this, 'KnowledgeBaseRole', {
      roleName: `enabl-kb-role-${environment}`,
      assumedBy: new iam.ServicePrincipal('bedrock.amazonaws.com'),
      inlinePolicies: {
        S3AccessPolicy: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                's3:GetObject',
                's3:ListBucket'
              ],
              resources: [
                this.knowledgeBucket.bucketArn,
                this.knowledgeBucket.arnForObjects('*')
              ]
            }),
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'bedrock:InvokeModel'
              ],
              resources: [
                'arn:aws:bedrock:*::foundation-model/amazon.titan-embed-text-v1'
              ]
            })
          ]
        })
      }
    });

    // Bedrock Knowledge Base
    this.knowledgeBase = new bedrock.CfnKnowledgeBase(this, 'EnablKnowledgeBase', {
      name: `enabl-global-health-kb-${environment}`,
      description: 'Enabl Health global medical knowledge base for RAG capabilities',
      roleArn: knowledgeBaseRole.roleArn,
      knowledgeBaseConfiguration: {
        type: 'VECTOR',
        vectorKnowledgeBaseConfiguration: {
          embeddingModelArn: 'arn:aws:bedrock:us-east-1::foundation-model/amazon.titan-embed-text-v1'
        }
      },
      storageConfiguration: {
        type: 'OPENSEARCH_SERVERLESS',
        opensearchServerlessConfiguration: {
          collectionArn: this.createOpenSearchCollection(environment).attrArn,
          vectorIndexName: 'enabl-health-index',
          fieldMapping: {
            vectorField: 'embedding',
            textField: 'text',
            metadataField: 'metadata'
          }
        }
      }
    });

    this.knowledgeBaseId = this.knowledgeBase.attrKnowledgeBaseId;

    // Data Source for the Knowledge Base
    new bedrock.CfnDataSource(this, 'KnowledgeBaseDataSource', {
      knowledgeBaseId: this.knowledgeBase.attrKnowledgeBaseId,
      name: `enabl-s3-datasource-${environment}`,
      description: 'S3 data source for Enabl Health medical documents',
      dataSourceConfiguration: {
        type: 'S3',
        s3Configuration: {
          bucketArn: this.knowledgeBucket.bucketArn,
          inclusionPrefixes: [
            'medical-guidelines/',
            'regional-healthcare/',
            'research-papers/',
            'document-templates/'
          ]
        }
      }
    });

    // Outputs
    new cdk.CfnOutput(this, 'KnowledgeBucketName', {
      value: this.knowledgeBucket.bucketName,
      description: 'S3 bucket name for knowledge base documents'
    });

    new cdk.CfnOutput(this, 'KnowledgeBaseId', {
      value: this.knowledgeBaseId,
      description: 'Bedrock Knowledge Base ID for RAG queries'
    });

    new cdk.CfnOutput(this, 'KnowledgeBaseArn', {
      value: this.knowledgeBase.attrKnowledgeBaseArn,
      description: 'Bedrock Knowledge Base ARN'
    });

    // Tags
    cdk.Tags.of(this).add('Project', 'Enabl Health');
    cdk.Tags.of(this).add('Component', 'Knowledge Base');
    cdk.Tags.of(this).add('Environment', environment);
  }

  private createOpenSearchCollection(environment: string) {
    // Create OpenSearch Serverless collection for vector storage
    const collectionName = `enabl-health-${environment}`;
    
    return new cdk.aws_opensearchserverless.CfnCollection(this, 'OpenSearchCollection', {
      name: collectionName,
      description: 'OpenSearch collection for Enabl Health knowledge base vectors',
      type: 'VECTORSEARCH',
      standbyReplicas: environment === 'production' ? 'ENABLED' : 'DISABLED'
    });
  }
}
