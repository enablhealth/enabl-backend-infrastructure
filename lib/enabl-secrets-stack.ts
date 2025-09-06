import * as cdk from 'aws-cdk-lib';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';

/**
 * Secrets Manager Only Stack for Enabl Health
 * 
 * This minimal stack deploys only AWS Secrets Manager secrets
 * for third-party credentials across all environments.
 * Deploy this first to configure credentials before main infrastructure.
 */

export interface SecretsStackProps extends cdk.StackProps {
  environment: 'development' | 'staging' | 'production';
}

export class EnablSecretsStack extends cdk.Stack {
  public readonly googleOAuthSecret: secretsmanager.Secret;
  public readonly appleSignInSecret: secretsmanager.Secret;

  constructor(scope: Construct, id: string, props: SecretsStackProps) {
    super(scope, id, props);

    const environment = props.environment;

    // Google OAuth Secret
    this.googleOAuthSecret = new secretsmanager.Secret(this, 'GoogleOAuthSecret', {
      secretName: this.getGoogleSecretName(environment),
      description: `Google OAuth credentials for ${environment} environment`,
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ 
          clientId: this.getGoogleClientId(environment),
          environment: environment,
          callbackUrls: this.getCallbackUrls(environment)
        }),
        generateStringKey: 'clientSecret',
        excludeCharacters: ' %+~`#$&*()|[]{}:;<>?!\'/@"\\',
      },
    });

    // Apple Sign-In Secret
    this.appleSignInSecret = new secretsmanager.Secret(this, 'AppleSignInSecret', {
      secretName: this.getAppleSecretName(environment),
      description: `Apple Sign-In credentials for ${environment} environment`,
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ 
          teamId: 'PENDING',
          keyId: 'PENDING',
          serviceId: this.getAppleServiceId(environment),
          environment: environment
        }),
        generateStringKey: 'privateKey',
        excludeCharacters: ' %+~`#$&*()|[]{}:;<>?!\'/@"\\',
      },
    });

    // Create outputs for easy access
    new cdk.CfnOutput(this, 'GoogleOAuthSecretName', {
      value: this.googleOAuthSecret.secretName,
      description: 'Google OAuth Secret Name',
      exportName: `GoogleOAuthSecret-${environment}`,
    });

    new cdk.CfnOutput(this, 'GoogleOAuthSecretArn', {
      value: this.googleOAuthSecret.secretArn,
      description: 'Google OAuth Secret ARN',
      exportName: `GoogleOAuthSecretArn-${environment}`,
    });

    new cdk.CfnOutput(this, 'AppleSignInSecretName', {
      value: this.appleSignInSecret.secretName,
      description: 'Apple Sign-In Secret Name',
      exportName: `AppleSignInSecret-${environment}`,
    });

    new cdk.CfnOutput(this, 'AppleSignInSecretArn', {
      value: this.appleSignInSecret.secretArn,
      description: 'Apple Sign-In Secret ARN',
      exportName: `AppleSignInSecretArn-${environment}`,
    });

    // Environment-specific instructions
    new cdk.CfnOutput(this, 'Instructions', {
      value: this.getInstructions(environment),
      description: 'Next steps for configuring secrets',
    });
  }

  private getGoogleSecretName(environment: string): string {
    return `google-oauth-${environment === 'development' ? 'dev' : environment === 'production' ? 'prod' : 'staging'}/client-secret`;
  }

  private getAppleSecretName(environment: string): string {
    return `apple-signin-${environment === 'development' ? 'dev' : environment === 'production' ? 'prod' : 'staging'}/credentials`;
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

  private getGoogleClientId(environment: string): string {
    switch (environment) {
      case 'development':
        return '842423158981-8ntg57v6hdb365nevu3d4ds9i2j7pooq.apps.googleusercontent.com';
      case 'staging':
        return 'STAGING_GOOGLE_CLIENT_ID_TO_BE_CREATED';
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

  private getInstructions(environment: string): string {
    return `Configure secrets in AWS Console for ${environment} environment. Update Google client secret and Apple credentials as needed.`;
  }
}
