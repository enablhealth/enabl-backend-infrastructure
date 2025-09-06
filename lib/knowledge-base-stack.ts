import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as bedrock from 'aws-cdk-lib/aws-bedrock';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as path from 'path';
import * as cr from 'aws-cdk-lib/custom-resources';
import { Construct } from 'constructs';

export interface KnowledgeBaseStackProps extends cdk.StackProps {
  environment: string;
  knowledgeBaseId?: string; // Optional pre-existing knowledge base ID
}

/**
 * Enabl Health Knowledge Base Stack
 * Creates S3 bucket and Bedrock Knowledge Base for RAG capabilities
 */
export class KnowledgeBaseStack extends cdk.Stack {
  public readonly knowledgeBucket: s3.Bucket;
  public readonly knowledgeBase?: bedrock.CfnKnowledgeBase;
  public readonly knowledgeBaseId?: string;
  public readonly dataSource?: bedrock.CfnDataSource;
  public readonly openSearchCollection: cdk.aws_opensearchserverless.CfnCollection;

  constructor(scope: Construct, id: string, props: KnowledgeBaseStackProps) {
    super(scope, id, props);

  const { environment } = props;
  const preprovisionOnly = this.node.tryGetContext('preprovisionOnly') === true || this.node.tryGetContext('preprovisionOnly') === 'true';

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
            }),
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'aoss:APIAccessAll'
              ],
              resources: [
                '*'
              ]
            })
          ]
        })
      }
    });

    // Create OpenSearch collection first
    this.openSearchCollection = this.createOpenSearchCollection(environment);

    // Bootstrap the OpenSearch index required by Bedrock KB via a Custom Resource
    const indexName = 'enabl-health-index';

    // Dedicated role with fixed name for AOSS data-plane access
    const indexBootstrapRole = new iam.Role(this, 'IndexBootstrapRole', {
      roleName: `enabl-kb-idx-bootstrap-${environment}`,
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')
      ]
    });

    indexBootstrapRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['aoss:APIAccessAll'],
      resources: ['*'],
    }));

  const indexBootstrapFn = new lambda.Function(this, 'OpenSearchIndexBootstrapFn', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      timeout: cdk.Duration.minutes(2),
      memorySize: 256,
      role: indexBootstrapRole,
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda/opensearch-index-bootstrap')),
      environment: {
        COLLECTION_ENDPOINT: this.openSearchCollection.attrCollectionEndpoint,
        INDEX_NAME: indexName,
        REGION: cdk.Stack.of(this).region,
    // flip to 'true' when we need to force index recreation (mapping changes)
    FORCE_RECREATE: this.node.tryGetContext('forceRecreateIndex') ? 'true' : 'false',
      },
    });

    // Allow the bootstrap lambda to access AOSS data plane
  // (role already has permissions)

    // Grant OpenSearch data access to the bootstrap lambda via a data policy
    const indexPolicyDoc: any = {
      Rules: [
        {
          Resource: [`collection/enabl-kb-${environment}`],
          Permission: ['aoss:CreateCollectionItems', 'aoss:DeleteCollectionItems', 'aoss:UpdateCollectionItems', 'aoss:DescribeCollectionItems'],
          ResourceType: 'collection'
        },
        {
          Resource: [`index/enabl-kb-${environment}/*`],
          Permission: ['aoss:CreateIndex', 'aoss:DeleteIndex', 'aoss:UpdateIndex', 'aoss:DescribeIndex', 'aoss:ReadDocument', 'aoss:WriteDocument'],
          ResourceType: 'index'
        }
      ],
      Principal: [
        `arn:aws:iam::${this.account}:role/enabl-kb-idx-bootstrap-${environment}`,
        `arn:aws:sts::${this.account}:assumed-role/enabl-kb-idx-bootstrap-${environment}/*`
      ]
    };

    const indexAccessPolicy = new cdk.aws_opensearchserverless.CfnAccessPolicy(this, 'IndexAccessPolicy', {
      name: `enabl-kb-idx-${environment}`,
      type: 'data',
      policy: JSON.stringify([indexPolicyDoc])
    });

  const provider = new cr.Provider(this, 'OpenSearchIndexBootstrapProvider', {
      onEventHandler: indexBootstrapFn,
    });
    // Bump this to trigger update when mapping changes
    const mappingVersion = this.node.tryGetContext('indexMappingVersion') || 'v1';

    const indexBootstrap = new cdk.CustomResource(this, 'OpenSearchIndexBootstrap', {
      serviceToken: provider.serviceToken,
      properties: {
        IndexName: indexName,
        MappingVersion: mappingVersion,
      }
    });

    // Ordering: collection -> access policy -> bootstrap
    indexAccessPolicy.addDependency(this.openSearchCollection);
    indexBootstrap.node.addDependency(indexAccessPolicy);

    if (!preprovisionOnly) {
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
            collectionArn: this.openSearchCollection.attrArn,
            vectorIndexName: indexName,
            fieldMapping: {
              vectorField: 'embedding',
              textField: 'text',
              metadataField: 'metadata'
            }
          }
        }
      });

      // Ensure knowledge base is created after OpenSearch index is bootstrapped
      this.knowledgeBase.node.addDependency(indexBootstrap);

      this.knowledgeBaseId = this.knowledgeBase.attrKnowledgeBaseId;

      // Data Source for the Knowledge Base
  this.dataSource = new bedrock.CfnDataSource(this, 'KnowledgeBaseDataSource', {
        knowledgeBaseId: this.knowledgeBase.attrKnowledgeBaseId,
        name: `enabl-s3-datasource-${environment}`,
        description: 'S3 data source for Enabl Health medical documents',
        dataSourceConfiguration: {
          type: 'S3',
          s3Configuration: {
            bucketArn: this.knowledgeBucket.bucketArn,
    // Bedrock current API expects max 1 inclusion prefix; target regional-healthcare for NDIS
    inclusionPrefixes: ['regional-healthcare/']
          }
        }
      });

      // Ensure data source is created after knowledge base
      this.dataSource.addDependency(this.knowledgeBase);
    }

    // Outputs
    new cdk.CfnOutput(this, 'KnowledgeBucketName', {
      value: this.knowledgeBucket.bucketName,
      description: 'S3 bucket name for knowledge base documents'
    });

    if (!preprovisionOnly) {
      new cdk.CfnOutput(this, 'KnowledgeBaseId', {
        value: this.knowledgeBaseId!,
        description: 'Bedrock Knowledge Base ID for RAG queries'
      });

      new cdk.CfnOutput(this, 'KnowledgeBaseArn', {
        value: this.knowledgeBase!.attrKnowledgeBaseArn,
        description: 'Bedrock Knowledge Base ARN'
      });

      new cdk.CfnOutput(this, 'DataSourceId', {
        value: this.dataSource!.attrDataSourceId,
        description: 'Bedrock Data Source ID for triggering ingestion'
      });
    }

    new cdk.CfnOutput(this, 'OpenSearchCollectionArn', {
      value: this.openSearchCollection.attrArn,
      description: 'OpenSearch Serverless Collection ARN'
    });
    new cdk.CfnOutput(this, 'OpenSearchCollectionName', {
      value: 'enabl-kb-' + environment,
      description: 'OpenSearch Serverless Collection Name'
    });
    new cdk.CfnOutput(this, 'OpenSearchIndexName', {
      value: 'enabl-health-index',
      description: 'Vector index name used by the knowledge base'
    });

    // Tags
    cdk.Tags.of(this).add('Project', 'Enabl Health');
    cdk.Tags.of(this).add('Component', 'Knowledge Base');
    cdk.Tags.of(this).add('Environment', environment);
  }

  private createOpenSearchCollection(environment: string) {
    // Create OpenSearch Serverless collection for vector storage
    const collectionName = `enabl-kb-${environment}`;
    
    // Create network policy for the collection
    const networkPolicy = new cdk.aws_opensearchserverless.CfnSecurityPolicy(this, 'NetworkPolicy', {
      name: `enabl-kb-net-${environment}`,
      type: 'network',
      policy: JSON.stringify([{
        Rules: [{
          Resource: [`collection/${collectionName}`],
          ResourceType: 'collection'
        }],
        AllowFromPublic: true
      }])
    });

    // Create encryption policy for the collection
    const encryptionPolicy = new cdk.aws_opensearchserverless.CfnSecurityPolicy(this, 'EncryptionPolicy', {
      name: `enabl-kb-enc-${environment}`,
      type: 'encryption',
      policy: JSON.stringify({
        Rules: [{
          Resource: [`collection/${collectionName}`],
          ResourceType: 'collection'
        }],
        AWSOwnedKey: true
      })
    });

    // Create data access policy for the collection
    const dataAccessPolicy = new cdk.aws_opensearchserverless.CfnAccessPolicy(this, 'DataAccessPolicy', {
      name: `enabl-kb-data-${environment}`,
      type: 'data',
      policy: JSON.stringify([{
        Rules: [{
          Resource: [`collection/${collectionName}`],
          Permission: ['aoss:CreateCollectionItems', 'aoss:DeleteCollectionItems', 'aoss:UpdateCollectionItems', 'aoss:DescribeCollectionItems'],
          ResourceType: 'collection'
        }, {
          Resource: [`index/${collectionName}/*`],
          Permission: ['aoss:CreateIndex', 'aoss:DeleteIndex', 'aoss:UpdateIndex', 'aoss:DescribeIndex', 'aoss:ReadDocument', 'aoss:WriteDocument'],
          ResourceType: 'index'
        }],
        Principal: [
          `arn:aws:iam::${this.account}:role/enabl-kb-role-${environment}`
        ]
      }])
    });

    const collection = new cdk.aws_opensearchserverless.CfnCollection(this, 'OpenSearchCollection', {
      name: collectionName,
      description: 'OpenSearch collection for Enabl Health knowledge base vectors',
      type: 'VECTORSEARCH',
      standbyReplicas: environment === 'production' ? 'ENABLED' : 'DISABLED'
    });

    // Add dependencies
    collection.addDependency(networkPolicy);
    collection.addDependency(encryptionPolicy); 
    collection.addDependency(dataAccessPolicy);

    return collection;
  }
}
