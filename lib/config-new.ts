import * as cdk from 'aws-cdk-lib';

/**
 * Configuration interface for Enabl Health backend infrastructure
 * Defines environment-specific settings and AWS resource configurations
 * 
 * Aligned with copilot instructions for three-tier environment strategy:
 * - Development: Lightweight resources for rapid iteration
 * - Staging: Production-like resources for realistic testing
 * - Production: Full-scale resources with high availability
 */
export interface EnablConfig {
  environment: 'development' | 'staging' | 'production';
  region: string;
  
  // Cognito configuration for authentication
  cognito: {
    userPoolName: string;
    userPoolClientName: string;
    domainPrefix: string;
    passwordPolicy: {
      minLength: number;
      requireLowercase: boolean;
      requireUppercase: boolean;
      requireDigits: boolean;
      requireSymbols: boolean;
    };
    oauth: {
      callbackUrls: string[];
      logoutUrls: string[];
    };
  };
  
  // DynamoDB configuration for data storage
  dynamodb: {
    tables: {
      users: string;
      chats: string;
      documents: string;
    };
    billingMode: 'PAY_PER_REQUEST' | 'PROVISIONED';
    pointInTimeRecovery: boolean;
  };
  
  // S3 configuration for document and knowledge base storage
  s3: {
    buckets: {
      documents: string;
      knowledgeBase: string;
    };
    corsOrigins: string[];
  };
  
  // Amazon Bedrock configuration for AI agents
  bedrock: {
    agents: {
      healthAssistant: {
        name: string;
        model: string; // amazon.nova-pro-v1:0
        description: string;
      };
      communityAgent: {
        name: string;
        model: string; // amazon.titan-text-express-v1
        description: string;
      };
      appointmentAgent: {
        name: string;
        model: string; // amazon.nova-lite-v1:0
        description: string;
      };
      documentAgent: {
        name: string;
        model: string; // amazon.titan-text-express-v1
        description: string;
      };
    };
    knowledgeBase: {
      name: string;
      description: string;
      vectorStoreType: 'opensearch-serverless';
    };
    guardrails: {
      enabled: boolean;
      blockedInputMessaging: string;
      blockedOutputMessaging: string;
    };
  };
  
  // AWS Secrets Manager for secure credential storage
  secretsManager: {
    googleOAuth: string;
    appleSignIn: string;
  };
  
  // Monitoring and compliance
  monitoring: {
    logRetention: number;
    enableCloudTrail: boolean; // For HIPAA compliance
    enableDetailedMetrics: boolean;
  };
}

/**
 * Development environment configuration
 * Minimal resources for cost-effective development
 */
const developmentConfig: EnablConfig = {
  environment: 'development',
  region: 'us-east-1',
  
  cognito: {
    userPoolName: 'enabl-users-dev',
    userPoolClientName: 'enabl-web-client-dev',
    domainPrefix: 'enabl-auth-dev',
    passwordPolicy: {
      minLength: 8,
      requireLowercase: true,
      requireUppercase: true,
      requireDigits: true,
      requireSymbols: false,
    },
    oauth: {
      callbackUrls: [
        'http://localhost:3000/api/auth/callback/google',
        'https://dev.enabl.health/api/auth/callback/google',
      ],
      logoutUrls: [
        'http://localhost:3000',
        'https://dev.enabl.health',
      ],
    },
  },
  
  dynamodb: {
    tables: {
      users: 'enabl-users-dev',
      chats: 'enabl-chat-dev',
      documents: 'enabl-documents-dev',
    },
    billingMode: 'PAY_PER_REQUEST',
    pointInTimeRecovery: false,
  },
  
  s3: {
    buckets: {
      documents: 'enabl-documents-dev',
      knowledgeBase: 'enabl-knowledge-base-dev',
    },
    corsOrigins: [
      'http://localhost:3000',
      'https://dev.enabl.health',
    ],
  },
  
  bedrock: {
    agents: {
      healthAssistant: {
        name: 'enabl-health-assistant-dev',
        model: 'amazon.titan-text-express-v1', // Cost-optimized for development
        description: 'Development health assistant agent for rapid iteration',
      },
      communityAgent: {
        name: 'enabl-community-agent-dev',
        model: 'amazon.titan-text-lite-v1', // Lightweight for development
        description: 'Development community content curation agent',
      },
      appointmentAgent: {
        name: 'enabl-appointment-agent-dev',
        model: 'amazon.nova-micro-v1:0', // Basic scheduling for development
        description: 'Development appointment scheduling agent',
      },
      documentAgent: {
        name: 'enabl-document-agent-dev',
        model: 'amazon.titan-text-express-v1', // Document processing for development
        description: 'Development document analysis agent',
      },
    },
    knowledgeBase: {
      name: 'enabl-knowledge-base-dev',
      description: 'Development knowledge base with minimal medical guidelines and test documents',
      vectorStoreType: 'opensearch-serverless',
    },
    guardrails: {
      enabled: false, // Disabled for development flexibility
      blockedInputMessaging: 'This input cannot be processed in development mode.',
      blockedOutputMessaging: 'This response was blocked by development guardrails.',
    },
  },
  
  secretsManager: {
    googleOAuth: 'google-oauth-dev/client-secret',
    appleSignIn: 'apple-signin-dev/credentials',
  },
  
  monitoring: {
    logRetention: 7, // 7 days for development
    enableCloudTrail: false,
    enableDetailedMetrics: false,
  },
};

/**
 * Staging environment configuration
 * Production-like resources for realistic testing
 */
const stagingConfig: EnablConfig = {
  environment: 'staging',
  region: 'us-east-1',
  
  cognito: {
    userPoolName: 'enabl-users-staging',
    userPoolClientName: 'enabl-web-client-staging',
    domainPrefix: 'enabl-auth-staging',
    passwordPolicy: {
      minLength: 12,
      requireLowercase: true,
      requireUppercase: true,
      requireDigits: true,
      requireSymbols: true,
    },
    oauth: {
      callbackUrls: [
        'https://staging.enabl.health/api/auth/callback/google',
      ],
      logoutUrls: [
        'https://staging.enabl.health',
      ],
    },
  },
  
  dynamodb: {
    tables: {
      users: 'enabl-users-staging',
      chats: 'enabl-chat-staging',
      documents: 'enabl-documents-staging',
    },
    billingMode: 'PROVISIONED',
    pointInTimeRecovery: true,
  },
  
  s3: {
    buckets: {
      documents: 'enabl-documents-staging',
      knowledgeBase: 'enabl-knowledge-base-staging',
    },
    corsOrigins: [
      'https://staging.enabl.health',
    ],
  },
  
  bedrock: {
    agents: {
      healthAssistant: {
        name: 'enabl-health-assistant-staging',
        model: 'amazon.nova-pro-v1:0', // Production-identical for realistic testing
        description: 'Staging health assistant agent identical to production',
      },
      communityAgent: {
        name: 'enabl-community-agent-staging',
        model: 'amazon.titan-text-express-v1', // Production-identical
        description: 'Staging community content curation agent',
      },
      appointmentAgent: {
        name: 'enabl-appointment-agent-staging',
        model: 'amazon.nova-lite-v1:0', // Production-identical
        description: 'Staging appointment scheduling agent',
      },
      documentAgent: {
        name: 'enabl-document-agent-staging',
        model: 'amazon.titan-text-express-v1', // Production-identical
        description: 'Staging document analysis agent',
      },
    },
    knowledgeBase: {
      name: 'enabl-knowledge-base-staging',
      description: 'Staging knowledge base with comprehensive medical guidelines and realistic test data',
      vectorStoreType: 'opensearch-serverless',
    },
    guardrails: {
      enabled: true, // Production-like guardrails
      blockedInputMessaging: 'This input cannot be processed due to safety concerns.',
      blockedOutputMessaging: 'This response was blocked by our safety guardrails.',
    },
  },
  
  secretsManager: {
    googleOAuth: 'google-oauth-staging/client-secret',
    appleSignIn: 'apple-signin-staging/credentials',
  },
  
  monitoring: {
    logRetention: 30, // 30 days for staging
    enableCloudTrail: true,
    enableDetailedMetrics: true,
  },
};

/**
 * Production environment configuration
 * Full-scale resources with high availability and security
 */
const productionConfig: EnablConfig = {
  environment: 'production',
  region: 'us-east-1',
  
  cognito: {
    userPoolName: 'enabl-users-prod',
    userPoolClientName: 'enabl-web-client-prod',
    domainPrefix: 'enabl-auth-prod',
    passwordPolicy: {
      minLength: 12,
      requireLowercase: true,
      requireUppercase: true,
      requireDigits: true,
      requireSymbols: true,
    },
    oauth: {
      callbackUrls: [
        'https://enabl.health/api/auth/callback/google',
      ],
      logoutUrls: [
        'https://enabl.health',
      ],
    },
  },
  
  dynamodb: {
    tables: {
      users: 'enabl-users-prod',
      chats: 'enabl-chat-prod',
      documents: 'enabl-documents-prod',
    },
    billingMode: 'PROVISIONED',
    pointInTimeRecovery: true,
  },
  
  s3: {
    buckets: {
      documents: 'enabl-documents-prod',
      knowledgeBase: 'enabl-knowledge-base-prod',
    },
    corsOrigins: [
      'https://enabl.health',
    ],
  },
  
  bedrock: {
    agents: {
      healthAssistant: {
        name: 'enabl-health-assistant-prod',
        model: 'amazon.nova-pro-v1:0', // Premium model for maximum accuracy
        description: 'Production health assistant agent with advanced reasoning capabilities',
      },
      communityAgent: {
        name: 'enabl-community-agent-prod',
        model: 'amazon.titan-text-express-v1', // Optimized for content curation
        description: 'Production community content curation and validation agent',
      },
      appointmentAgent: {
        name: 'enabl-appointment-agent-prod',
        model: 'amazon.nova-lite-v1:0', // Efficient scheduling intelligence
        description: 'Production appointment scheduling and management agent',
      },
      documentAgent: {
        name: 'enabl-document-agent-prod',
        model: 'amazon.titan-text-express-v1', // Secure document handling
        description: 'Production document analysis and management agent',
      },
    },
    knowledgeBase: {
      name: 'enabl-knowledge-base-prod',
      description: 'Production knowledge base with complete medical guidelines and verified content',
      vectorStoreType: 'opensearch-serverless',
    },
    guardrails: {
      enabled: true, // Maximum safety for production
      blockedInputMessaging: 'I cannot process this request as it may violate our safety guidelines.',
      blockedOutputMessaging: 'I cannot provide this response as it was blocked by our safety measures.',
    },
  },
  
  secretsManager: {
    googleOAuth: 'google-oauth-prod/client-secret',
    appleSignIn: 'apple-signin-prod/credentials',
  },
  
  monitoring: {
    logRetention: 365, // 1 year for production
    enableCloudTrail: true,
    enableDetailedMetrics: true,
  },
};

/**
 * Get configuration based on environment
 */
export function getConfig(environment?: string): EnablConfig {
  const env = environment || process.env.CDK_ENVIRONMENT || 'development';
  
  switch (env) {
    case 'development':
      return developmentConfig;
    case 'staging':
      return stagingConfig;
    case 'production':
      return productionConfig;
    default:
      throw new Error(`Unknown environment: ${env}`);
  }
}

/**
 * Validate configuration to ensure all required values are present
 */
export function validateConfig(config: EnablConfig): void {
  if (!config.environment) {
    throw new Error('Environment must be specified');
  }
  
  if (!config.region) {
    throw new Error('AWS region must be specified');
  }
  
  if (!config.cognito.userPoolName) {
    throw new Error('Cognito user pool name must be specified');
  }
  
  if (!config.dynamodb.tables.users) {
    throw new Error('DynamoDB users table name must be specified');
  }
  
  if (!config.s3.buckets.documents) {
    throw new Error('S3 documents bucket name must be specified');
  }
  
  // Validate HIPAA compliance requirements for staging and production
  if (config.environment !== 'development') {
    if (!config.monitoring.enableCloudTrail) {
      console.warn('WARNING: CloudTrail should be enabled for HIPAA compliance in staging/production');
    }
    
    if (!config.dynamodb.pointInTimeRecovery) {
      console.warn('WARNING: Point-in-time recovery should be enabled for HIPAA compliance in staging/production');
    }
  }
}

export default {
  getConfig,
  validateConfig,
  developmentConfig,
  stagingConfig,
  productionConfig,
};
