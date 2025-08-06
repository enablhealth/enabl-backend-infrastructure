import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { EnablBackendStack } from '../lib/enabl-backend-stack';
import { getConfig } from '../lib/config';

describe('EnablBackendStack', () => {
  // Helper function to create a fresh stack for each test
  const createTestStack = (testName: string) => {
    const app = new cdk.App();
    const config = getConfig('development');
    
    const stack = new EnablBackendStack(app, `TestStack-${testName}`, {
      config,
      env: {
        account: '123456789012',
        region: 'us-east-1',
      },
    });
    
    return { app, stack, template: Template.fromStack(stack) };
  };

  test('Creates Cognito User Pool', () => {
    const { template } = createTestStack('CognitoUserPool');
    
    template.hasResourceProperties('AWS::Cognito::UserPool', {
      UserPoolName: 'enabl-users-dev',
      Policies: {
        PasswordPolicy: {
          MinimumLength: 8,
          RequireLowercase: true,
          RequireNumbers: true,
          RequireSymbols: false,
          RequireUppercase: true,
        },
      },
    });
  });

  test('Creates Cognito User Pool Client', () => {
    const { template } = createTestStack('CognitoUserPoolClient');
    
    template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      GenerateSecret: false,
      ExplicitAuthFlows: ['ALLOW_USER_SRP_AUTH', 'ALLOW_REFRESH_TOKEN_AUTH'],
      AllowedOAuthFlowsUserPoolClient: true,
      AllowedOAuthFlows: ['code'],
      PreventUserExistenceErrors: 'ENABLED'
    });
  });

  test('Creates DynamoDB Tables', () => {
    const { template } = createTestStack('DynamoDBTables');
    
    // Check Users table
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: 'enabl-users-dev',
      KeySchema: [
        {
          AttributeName: 'userId',
          KeyType: 'HASH',
        },
      ],
      AttributeDefinitions: [
        {
          AttributeName: 'userId',
          AttributeType: 'S',
        },
      ],
      BillingMode: 'PAY_PER_REQUEST',
    });
  });

  test('Creates S3 Buckets', () => {
    const { template } = createTestStack('S3Buckets');
    
    template.hasResourceProperties('AWS::S3::Bucket', {
      BucketName: 'enabl-documents-dev',
    });

    template.hasResourceProperties('AWS::S3::Bucket', {
      BucketName: 'enabl-user-uploads-dev',
    });
  });

  test('Creates API Gateway', () => {
    const { template } = createTestStack('APIGateway');
    
    template.hasResourceProperties('AWS::ApiGateway::RestApi', {
      Name: 'enabl-api-dev',
      Description: 'Enabl Health API - Development Environment',
    });
  });

  test('Validates Resource Count', () => {
    const { template } = createTestStack('ResourceCount');
    
    // Verify we have the expected number of key resources
    const resources = template.toJSON().Resources;
    
    // Count DynamoDB tables (should have 5)
    const dynamoTables = Object.keys(resources).filter(key => 
      resources[key].Type === 'AWS::DynamoDB::Table'
    );
    expect(dynamoTables.length).toBe(5);
    
    // Count S3 buckets (should have 3)
    const s3Buckets = Object.keys(resources).filter(key => 
      resources[key].Type === 'AWS::S3::Bucket'
    );
    expect(s3Buckets.length).toBe(3);
    
    // Should have 1 User Pool
    const userPools = Object.keys(resources).filter(key => 
      resources[key].Type === 'AWS::Cognito::UserPool'
    );
    expect(userPools.length).toBe(1);
    
    // Should have 1 API Gateway
    const apiGateways = Object.keys(resources).filter(key => 
      resources[key].Type === 'AWS::ApiGateway::RestApi'
    );
    expect(apiGateways.length).toBe(1);
  });
});
