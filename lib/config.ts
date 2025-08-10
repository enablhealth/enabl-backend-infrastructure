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
    socialProviders: {
      google: {
        clientId: string;
        clientSecret: string;
      };
      apple: {
        serviceId: string;
        teamId: string;
        keyId: string;
        privateKey: string;
      };
    };
  };
  
  // DynamoDB configuration for data storage
  dynamodb: {
    tables: {
      users: string;
      chats: string;
      documents: string;
      appointments: string;
      integrations: string;
    };
    billingMode: 'PAY_PER_REQUEST' | 'PROVISIONED';
    pointInTimeRecovery: boolean;
  };
  
  // S3 configuration for document and knowledge base storage
  s3: {
    buckets: {
      documents: string;
      knowledgeBase: string;
      userUploads: string;
      backups: string;
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
  
  // API Gateway configuration
  api: {
    name: string;
    description: string;
    throttle: {
      rateLimit: number;
      burstLimit: number;
    };
  };
  
  // Lambda configuration
  lambda: {
    timeout: number;
    memorySize: number;
    environment: {
      [key: string]: string;
    };
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
    socialProviders: {
      google: {
        clientId: '842423158981-8ntg57v6hdb365nevu3d4ds9i2j7pooq.apps.googleusercontent.com',
        clientSecret: 'PENDING', // Will be retrieved from Secrets Manager
      },
      apple: {
        serviceId: 'health.enabl.dev',
        teamId: 'PENDING',
        keyId: 'PENDING',
        privateKey: 'PENDING',
      },
    },
  },
  
  dynamodb: {
    tables: {
      users: 'enabl-users-dev',
      chats: 'enabl-chat-dev',
      documents: 'enabl-documents-dev',
      appointments: 'enabl-appointments-dev',
      integrations: 'enabl-integrations-dev',
    },
    billingMode: 'PAY_PER_REQUEST',
    pointInTimeRecovery: false,
  },
  
  s3: {
    buckets: {
      documents: 'enabl-documents-dev',
      knowledgeBase: 'enabl-knowledge-base-dev',
      userUploads: 'enabl-user-uploads-dev',
      backups: 'enabl-backups-dev',
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
  
  api: {
    name: 'enabl-api-dev',
    description: 'Enabl Health Development API',
    throttle: {
      rateLimit: 100,
      burstLimit: 200,
    },
  },
  
  lambda: {
    timeout: 30,
    memorySize: 512,
    environment: {
      NODE_ENV: 'development',
      LOG_LEVEL: 'debug',
    },
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
    socialProviders: {
      google: {
        clientId: '665236506157-j0kr2dhcms8cvgjcoa27k11mejqn59qf.apps.googleusercontent.com',
        clientSecret: 'PENDING', // Will be retrieved from Secrets Manager
      },
      apple: {
        serviceId: 'health.enabl.staging',
        teamId: 'PENDING',
        keyId: 'PENDING',
        privateKey: 'PENDING',
      },
    },
  },
  
  dynamodb: {
    tables: {
      users: 'enabl-users-staging',
      chats: 'enabl-chat-staging',
      documents: 'enabl-documents-staging',
      appointments: 'enabl-appointments-staging',
      integrations: 'enabl-integrations-staging',
    },
    billingMode: 'PAY_PER_REQUEST',
    pointInTimeRecovery: true,
  },
  
  s3: {
    buckets: {
      documents: 'enabl-documents-staging',
      knowledgeBase: 'enabl-knowledge-base-staging',
      userUploads: 'enabl-user-uploads-staging',
      backups: 'enabl-backups-staging',
    },
    corsOrigins: [
      'https://staging.enabl.health',
    ],
  },
  
  bedrock: {
    agents: {
      healthAssistant: {
        name: 'enabl-health-assistant-staging',
        model: 'amazon.nova-pro-v1:0', // Production-identical model
        description: 'Staging health assistant agent with advanced reasoning',
      },
      communityAgent: {
        name: 'enabl-community-agent-staging',
        model: 'amazon.titan-text-express-v1', // Content curation
        description: 'Staging community content curation agent',
      },
      appointmentAgent: {
        name: 'enabl-appointment-agent-staging',
        model: 'amazon.nova-lite-v1:0', // Scheduling intelligence
        description: 'Staging appointment scheduling agent',
      },
      documentAgent: {
        name: 'enabl-document-agent-staging',
        model: 'amazon.titan-text-express-v1', // Document analysis
        description: 'Staging document analysis agent',
      },
    },
    knowledgeBase: {
      name: 'enabl-knowledge-base-staging',
      description: 'Staging knowledge base with comprehensive medical guidelines and realistic test data',
      vectorStoreType: 'opensearch-serverless',
    },
    guardrails: {
      enabled: true, // Enabled for production-like testing
      blockedInputMessaging: 'This input cannot be processed due to safety guidelines.',
      blockedOutputMessaging: 'This response was blocked by safety guardrails.',
    },
  },
  
  secretsManager: {
    googleOAuth: 'google-oauth-staging/client-secret',
    appleSignIn: 'apple-signin-staging/credentials',
  },
  
  api: {
    name: 'enabl-api-staging',
    description: 'Enabl Health Staging API',
    throttle: {
      rateLimit: 500,
      burstLimit: 1000,
    },
  },
  
  lambda: {
    timeout: 60,
    memorySize: 1024,
    environment: {
      NODE_ENV: 'staging',
      LOG_LEVEL: 'info',
    },
  },
  
  monitoring: {
    logRetention: 30, // 30 days for staging
    enableCloudTrail: true,
    enableDetailedMetrics: true,
  },
};

/**
 * Production environment configuration
 * Full-scale resources with high availability and compliance
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
    socialProviders: {
      google: {
        clientId: '965402584740-1j4t43ijt0rvlg2lq9hhaots5kg9v2tm.apps.googleusercontent.com',
        clientSecret: 'PENDING', // Will be retrieved from Secrets Manager
      },
      apple: {
        serviceId: 'health.enabl',
        teamId: 'PENDING',
        keyId: 'PENDING',
        privateKey: 'PENDING',
      },
    },
  },
  
  dynamodb: {
    tables: {
      users: 'enabl-users-prod',
      chats: 'enabl-chat-prod',
      documents: 'enabl-documents-prod',
      appointments: 'enabl-appointments-prod',
      integrations: 'enabl-integrations-prod',
    },
    billingMode: 'PAY_PER_REQUEST',
    pointInTimeRecovery: true,
  },
  
  s3: {
    buckets: {
      documents: 'enabl-documents-prod',
      knowledgeBase: 'enabl-knowledge-base-prod',
      userUploads: 'enabl-user-uploads-prod',
      backups: 'enabl-backups-prod',
    },
    corsOrigins: [
      'https://enabl.health',
    ],
  },
  
  bedrock: {
    agents: {
      healthAssistant: {
        name: 'enabl-health-assistant-prod',
        model: 'amazon.nova-pro-v1:0', // Premium health guidance
        description: 'Production health assistant agent with maximum accuracy and safety',
      },
      communityAgent: {
        name: 'enabl-community-agent-prod',
        model: 'amazon.titan-text-express-v1', // Reliable content curation
        description: 'Production community content curation agent',
      },
      appointmentAgent: {
        name: 'enabl-appointment-agent-prod',
        model: 'amazon.nova-lite-v1:0', // Efficient scheduling
        description: 'Production appointment scheduling agent',
      },
      documentAgent: {
        name: 'enabl-document-agent-prod',
        model: 'amazon.titan-text-express-v1', // Secure document handling
        description: 'Production document analysis agent',
      },
    },
    knowledgeBase: {
      name: 'enabl-knowledge-base-prod',
      description: 'Production knowledge base with complete medical guidelines and verified content',
      vectorStoreType: 'opensearch-serverless',
    },
    guardrails: {
      enabled: true, // Maximum safety for production
      blockedInputMessaging: 'This input cannot be processed due to safety and compliance guidelines.',
      blockedOutputMessaging: 'This response was blocked by safety guardrails to ensure user safety.',
    },
  },
  
  secretsManager: {
    googleOAuth: 'google-oauth-prod/client-secret',
    appleSignIn: 'apple-signin-prod/credentials',
  },
  
  api: {
    name: 'enabl-api-prod',
    description: 'Enabl Health Production API',
    throttle: {
      rateLimit: 1000,
      burstLimit: 2000,
    },
  },
  
  lambda: {
    timeout: 90,
    memorySize: 2048,
    environment: {
      NODE_ENV: 'production',
      LOG_LEVEL: 'warn',
    },
  },
  
  monitoring: {
    logRetention: 365, // 1 year for production (HIPAA compliance)
    enableCloudTrail: true,
    enableDetailedMetrics: true,
  },
};

export function getConfig(environment?: string): EnablConfig {
  const env = environment || process.env.NODE_ENV || 'development';
  
  switch (env) {
    case 'development':
      return developmentConfig;
    case 'staging':
      return stagingConfig;
    case 'production':
      return productionConfig;
    default:
      console.warn(`Unknown environment: ${env}, defaulting to development`);
      return developmentConfig;
  }
}

export function validateConfig(config: EnablConfig): void {
  if (!config.environment || !config.region) {
    throw new Error('Environment and region are required');
  }
  
  if (!config.cognito.userPoolName || !config.cognito.userPoolClientName) {
    throw new Error('Cognito configuration is incomplete');
  }
  
  if (!Object.values(config.dynamodb.tables).every(Boolean)) {
    throw new Error('All DynamoDB table names must be specified');
  }
  
  if (!Object.values(config.s3.buckets).every(Boolean)) {
    throw new Error('All S3 bucket names must be specified');
  }
}
