import * as cdk from 'aws-cdk-lib';
import * as opensearch from 'aws-cdk-lib/aws-opensearchserverless';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

export interface OpenSearchVectorStackProps extends cdk.StackProps {
  environment: string;
}

export class OpenSearchVectorStack extends cdk.Stack {
  public readonly collectionEndpoint: string;
  public readonly collectionId: string;
  public readonly collectionArn: string;

  constructor(scope: Construct, id: string, props: OpenSearchVectorStackProps) {
    super(scope, id, props);

    const { environment } = props;

    // Security policy for the collection
    const securityPolicy = new opensearch.CfnSecurityPolicy(this, 'DocumentVectorSecurityPolicy', {
      name: `enabl-documents-security-${environment}`,
      type: 'encryption',
      policy: JSON.stringify({
        Rules: [
          {
            Resource: [`collection/enabl-documents-${environment}`],
            ResourceType: 'collection'
          }
        ],
        AWSOwnedKey: true
      })
    });

    // Network policy for the collection
    const networkPolicy = new opensearch.CfnSecurityPolicy(this, 'DocumentVectorNetworkPolicy', {
      name: `enabl-documents-network-${environment}`,
      type: 'network',
      policy: JSON.stringify([
        {
          Rules: [
            {
              Resource: [`collection/enabl-documents-${environment}`],
              ResourceType: 'collection'
            }
          ],
          AllowFromPublic: true
        }
      ])
    });

    // OpenSearch Serverless collection for vector storage
    const vectorCollection = new opensearch.CfnCollection(this, 'DocumentVectorCollection', {
      name: `enabl-documents-${environment}`,
      type: 'VECTORSEARCH',
      description: `Enabl Health document vector embeddings - ${environment}`,
    });

    vectorCollection.addDependency(securityPolicy);
    vectorCollection.addDependency(networkPolicy);

    // Store collection properties
    this.collectionEndpoint = vectorCollection.attrCollectionEndpoint;
    this.collectionId = vectorCollection.attrId;
    this.collectionArn = vectorCollection.attrArn;

    // Data access policy - will be updated with Lambda role ARNs
    const dataAccessPolicy = new opensearch.CfnAccessPolicy(this, 'DocumentVectorDataPolicy', {
      name: `enabl-documents-data-${environment}`,
      type: 'data',
      policy: JSON.stringify([
        {
          Rules: [
            {
              Resource: [`collection/enabl-documents-${environment}`],
              Permission: [
                'aoss:CreateCollectionItems',
                'aoss:DeleteCollectionItems',
                'aoss:UpdateCollectionItems',
                'aoss:DescribeCollectionItems'
              ],
              ResourceType: 'collection'
            },
            {
              Resource: [`index/enabl-documents-${environment}/*`],
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
            // Lambda execution roles will be added here
            `arn:aws:iam::${this.account}:role/enabl-*lambda*`,
            `arn:aws:iam::${this.account}:role/enabl-*bedrock*`
          ]
        }
      ])
    });

    // DynamoDB table for user knowledge base metadata
    const userKnowledgeBasesTable = new cdk.aws_dynamodb.Table(this, 'UserKnowledgeBasesTable', {
      tableName: `enabl-user-knowledge-bases-${environment}`,
      partitionKey: { name: 'userId', type: cdk.aws_dynamodb.AttributeType.STRING },
      billingMode: cdk.aws_dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: cdk.aws_dynamodb.TableEncryption.AWS_MANAGED,
      pointInTimeRecovery: environment === 'production',
      removalPolicy: environment === 'development' ? cdk.RemovalPolicy.DESTROY : cdk.RemovalPolicy.RETAIN
    });

    // Output the collection details
    new cdk.CfnOutput(this, 'VectorCollectionEndpoint', {
      value: this.collectionEndpoint,
      description: 'OpenSearch Serverless collection endpoint',
      exportName: `enabl-opensearch-endpoint-${environment}`
    });

    new cdk.CfnOutput(this, 'VectorCollectionId', {
      value: this.collectionId,
      description: 'OpenSearch Serverless collection ID',
      exportName: `enabl-opensearch-collection-id-${environment}`
    });

    new cdk.CfnOutput(this, 'VectorCollectionArn', {
      value: this.collectionArn,
      description: 'OpenSearch Serverless collection ARN',
      exportName: `enabl-opensearch-collection-arn-${environment}`
    });

    new cdk.CfnOutput(this, 'UserKnowledgeBasesTableName', {
      value: userKnowledgeBasesTable.tableName,
      description: 'DynamoDB table for user knowledge bases',
      exportName: `enabl-user-kb-table-${environment}`
    });

    new cdk.CfnOutput(this, 'UserKnowledgeBasesTableArn', {
      value: userKnowledgeBasesTable.tableArn,
      description: 'DynamoDB table ARN for user knowledge bases',
      exportName: `enabl-user-kb-table-arn-${environment}`
    });
  }
}
