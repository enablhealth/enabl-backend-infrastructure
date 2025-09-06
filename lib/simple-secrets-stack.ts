import * as cdk from 'aws-cdk-lib';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';

/**
 * Simple Secrets Manager Stack for Enabl Health
 * Standalone deployment without dependencies
 */

export interface SimpleSecretsStackProps extends cdk.StackProps {
  environment: 'development' | 'staging' | 'production';
}

export class SimpleSecretsStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: SimpleSecretsStackProps) {
    super(scope, id, props);

    const { environment } = props;

    // Google OAuth Secret
    const googleSecret = new secretsmanager.Secret(this, 'GoogleOAuthSecret', {
      secretName: `google-oauth-${environment === 'development' ? 'dev' : environment === 'production' ? 'prod' : 'staging'}/client-secret`,
      description: `Google OAuth credentials for ${environment} environment`,
      secretStringValue: cdk.SecretValue.unsafePlainText(JSON.stringify({
        clientId: this.getGoogleClientId(environment),
        clientSecret: 'REPLACE_WITH_ACTUAL_SECRET',
        environment: environment,
        callbackUrls: this.getCallbackUrls(environment)
      })),
    });

    // Apple Sign-In Secret
    const appleSecret = new secretsmanager.Secret(this, 'AppleSignInSecret', {
      secretName: `apple-signin-${environment === 'development' ? 'dev' : environment === 'production' ? 'prod' : 'staging'}/credentials`,
      description: `Apple Sign-In credentials for ${environment} environment`,
      secretStringValue: cdk.SecretValue.unsafePlainText(JSON.stringify({
        teamId: 'REPLACE_WITH_ACTUAL_TEAM_ID',
        keyId: 'REPLACE_WITH_ACTUAL_KEY_ID',
        serviceId: this.getAppleServiceId(environment),
        privateKey: 'REPLACE_WITH_ACTUAL_PRIVATE_KEY',
        environment: environment
      })),
    });

    // Outputs
    new cdk.CfnOutput(this, 'GoogleOAuthSecretName', {
      value: googleSecret.secretName,
      description: 'Google OAuth Secret Name',
    });

    new cdk.CfnOutput(this, 'AppleSignInSecretName', {
      value: appleSecret.secretName,
      description: 'Apple Sign-In Secret Name',
    });

    new cdk.CfnOutput(this, 'Instructions', {
      value: `Go to AWS Secrets Manager console and update the secret values for ${environment} environment`,
      description: 'Next steps',
    });
  }

  private getGoogleClientId(environment: string): string {
    switch (environment) {
      case 'development':
        return '842423158981-8ntg57v6hdb365nevu3d4ds9i2j7pooq.apps.googleusercontent.com';
      case 'staging':
        return 'CREATE_STAGING_GOOGLE_CLIENT_ID';
      case 'production':
        return '965402584740-1j4t43ijt0rvlg2lq9hhaots5kg9v2tm.apps.googleusercontent.com';
      default:
        return '';
    }
  }

  private getAppleServiceId(environment: string): string {
    switch (environment) {
      case 'development':
        return 'health.enabl.dev';
      case 'staging':
        return 'health.enabl.staging';
      case 'production':
        return 'health.enabl';
      default:
        return '';
    }
  }

  private getCallbackUrls(environment: string): string[] {
    switch (environment) {
      case 'development':
        return [
          'http://localhost:3000/api/auth/callback/google',
          'https://dev.enabl.health/api/auth/callback/google',
        ];
      case 'staging':
        return ['https://staging.enabl.health/api/auth/callback/google'];
      case 'production':
        return ['https://enabl.health/api/auth/callback/google'];
      default:
        return [];
    }
  }
}
