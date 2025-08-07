import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import { Construct } from 'constructs';

export interface KnowledgeBaseStackProps extends cdk.StackProps {
  environment: string;
}

/**
 * Enabl Health Knowledge Base S3 Stack
 * Creates S3 bucket for medical documents (Phase 1)
 * Bedrock Knowledge Base integration will be added in Phase 2
 */
export class KnowledgeBaseStack extends cdk.Stack {
  public readonly knowledgeBucket: s3.Bucket;

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

    // Outputs
    new cdk.CfnOutput(this, 'KnowledgeBucketName', {
      value: this.knowledgeBucket.bucketName,
      description: 'S3 bucket name for knowledge base documents'
    });

    new cdk.CfnOutput(this, 'KnowledgeBucketArn', {
      value: this.knowledgeBucket.bucketArn,
      description: 'S3 bucket ARN for knowledge base documents'
    });

    // Tags
    cdk.Tags.of(this).add('Project', 'Enabl Health');
    cdk.Tags.of(this).add('Component', 'Knowledge Base');
    cdk.Tags.of(this).add('Environment', environment);
  }
}
