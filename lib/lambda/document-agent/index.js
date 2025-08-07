/**
 * Enabl Document Agent
 * 
 * Handles document analysis, medical document interpretation,
 * and provides insights from uploaded health documents.
 */

const { BedrockAgentRuntimeClient, InvokeAgentCommand } = require('@aws-sdk/client-bedrock-agent-runtime');
const { BedrockRuntimeClient, InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');
const { S3Client, GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const { DynamoDBClient, PutItemCommand, GetItemCommand, QueryCommand } = require('@aws-sdk/client-dynamodb');

const bedrockAgent = new BedrockAgentRuntimeClient({ region: process.env.REGION });
const bedrock = new BedrockRuntimeClient({ region: process.env.REGION });
const s3 = new S3Client({ region: process.env.REGION });
const dynamodb = new DynamoDBClient({ region: process.env.REGION });

exports.handler = async (event) => {
  try {
    const { message, userId, sessionId, context, documentId } = JSON.parse(event.body);
    
    console.log('Document Agent request:', { 
      userId, 
      sessionId, 
      messageLength: message?.length,
      documentId 
    });

    // System prompt for document agent
    const systemPrompt = `You are the Enabl Document Agent, specializing in analyzing and interpreting health-related documents.

Your capabilities:
- Analyze medical reports, lab results, and test documents
- Explain medical terminology in simple, understandable language
- Summarize key findings from health documents
- Identify important trends in health data over time
- Suggest questions to ask healthcare providers based on document content
- Categorize and organize health documents
- Extract key metrics and values from medical documents
- Provide context for lab values and test results
- Highlight urgent or concerning findings that need attention

Guidelines:
- Always emphasize that document analysis is for informational purposes only
- Recommend discussing all findings with qualified healthcare providers
- Explain medical terms in accessible language
- Highlight both normal and abnormal findings clearly
- Suggest follow-up questions for healthcare appointments
- Respect patient privacy and handle documents securely
- Focus on educational interpretation, not medical diagnosis
- Encourage users to keep organized health records

Important: Document analysis is for educational purposes only. Always consult healthcare providers for medical interpretation and decisions.`;

    // Analyze the message to determine document intent
    const intentAnalysis = await analyzeDocumentIntent(message);
    
    let response = '';
    let documentContent = null;

    // If a document ID is provided, retrieve and analyze the document
    if (documentId) {
      try {
        documentContent = await retrieveDocument(documentId, userId);
      } catch (error) {
        console.log('Document retrieval error:', error.message);
      }
    }

    // Use Bedrock AgentCore for intelligent document analysis
    try {
      const agentResponse = await generateAgentResponse(message, systemPrompt, intentAnalysis, documentContent, userId);
      response = agentResponse.response;
    } catch (error) {
      console.log('AgentCore error, falling back to direct model:', error.message);
      
      // Fallback to direct Bedrock model if AgentCore is unavailable
      try {
        const bedrockResponse = await generateAIResponse(message, systemPrompt, intentAnalysis, documentContent, userId);
        response = bedrockResponse.response;
      } catch (fallbackError) {
        console.log('Bedrock fallback error:', fallbackError.message);
        response = generateFallbackResponse(message, intentAnalysis, documentContent);
      }
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
      },
      body: JSON.stringify({
        response: response,
        agentType: 'document-agent',
        sessionId: sessionId || `document-${userId}-${Date.now()}`,
        intent: intentAnalysis.intent,
        documentAnalyzed: !!documentContent,
        timestamp: new Date().toISOString(),
        supportedFormats: [
          'PDF documents',
          'Lab reports (PDF, text)',
          'Medical imaging reports',
          'Prescription summaries',
          'Test results',
          'Health screening reports'
        ]
      }),
    };

  } catch (error) {
    console.error('Document Agent error:', error);
    
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        error: 'Sorry, I had trouble analyzing that document. Please try again.',
        agentType: 'document-agent',
        timestamp: new Date().toISOString(),
      }),
    };
  }
};

/**
 * Analyze user intent for document-related queries
 */
async function analyzeDocumentIntent(message) {
  const messageLower = message.toLowerCase();
  
  const intents = {
    uploadDocument: [
      'upload', 'add document', 'submit', 'attach', 'share document',
      'analyze document', 'review file'
    ],
    explainResults: [
      'explain', 'what does this mean', 'interpret', 'understand',
      'break down', 'clarify', 'help me understand'
    ],
    summarizeDocument: [
      'summarize', 'summary', 'overview', 'key points', 'main findings',
      'important results', 'highlights'
    ],
    compareDocuments: [
      'compare', 'comparison', 'difference', 'changes over time',
      'trend', 'progress', 'improvement'
    ],
    organizeDocuments: [
      'organize', 'categorize', 'sort', 'manage', 'file',
      'tag', 'label', 'group'
    ],
    questionPrep: [
      'questions', 'ask doctor', 'appointment prep', 'follow up',
      'discuss with provider', 'next steps'
    ]
  };

  let detectedIntent = 'general';
  let confidence = 0;

  for (const [intent, keywords] of Object.entries(intents)) {
    const matches = keywords.filter(keyword => messageLower.includes(keyword));
    const currentConfidence = matches.length / keywords.length;
    
    if (currentConfidence > confidence) {
      confidence = currentConfidence;
      detectedIntent = intent;
    }
  }

  return {
    intent: detectedIntent,
    confidence,
    documentType: extractDocumentType(message)
  };
}

/**
 * Extract the document type from the message
 */
function extractDocumentType(message) {
  const messageLower = message.toLowerCase();
  
  const documentTypes = [
    'lab results', 'blood test', 'urine test', 'x-ray', 'mri', 'ct scan',
    'prescription', 'medication list', 'discharge summary', 'pathology report',
    'imaging report', 'ecg', 'ekg', 'ultrasound', 'mammogram', 'biopsy'
  ];
  
  for (const docType of documentTypes) {
    if (messageLower.includes(docType)) {
      return docType;
    }
  }
  
  return 'health document';
}

/**
 * Retrieve document from S3 storage
 */
async function retrieveDocument(documentId, userId) {
  try {
    // First check if document exists in DynamoDB
    const docRecord = await dynamodb.send(new GetItemCommand({
      TableName: process.env.DOCUMENTS_TABLE || 'EnablDocuments',
      Key: {
        documentId: { S: documentId },
        userId: { S: userId }
      }
    }));

    if (!docRecord.Item) {
      throw new Error('Document not found');
    }

    // Retrieve document content from S3
    const s3Key = docRecord.Item.s3Key.S;
    const s3Response = await s3.send(new GetObjectCommand({
      Bucket: process.env.DOCUMENTS_BUCKET,
      Key: s3Key
    }));

    // Convert stream to string (assuming text-based documents)
    const documentText = await streamToString(s3Response.Body);
    
    return {
      id: documentId,
      type: docRecord.Item.documentType?.S || 'unknown',
      content: documentText,
      uploadDate: docRecord.Item.uploadDate?.S,
      metadata: JSON.parse(docRecord.Item.metadata?.S || '{}')
    };
  } catch (error) {
    console.error('Document retrieval error:', error);
    throw error;
  }
}

/**
 * Convert stream to string
 */
async function streamToString(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf-8');
}

/**
 * Generate AI response using Bedrock AgentCore with document analysis capabilities
 */
async function generateAgentResponse(message, systemPrompt, intentAnalysis, documentContent, userId) {
  try {
    const agentInput = {
      inputText: message,
      sessionId: `document-agent-${userId}-${Date.now()}`,
      agentId: process.env.BEDROCK_DOCUMENT_AGENT_ID || 'default-document-agent',
      agentAliasId: process.env.BEDROCK_AGENT_ALIAS_ID || 'TSTALIASID'
    };

    // Add document-specific session attributes
    const sessionAttributes = {
      userIntent: intentAnalysis.intent,
      confidence: intentAnalysis.confidence.toString(),
      documentType: intentAnalysis.documentType,
      hasDocument: (!!documentContent).toString(),
      systemPrompt: systemPrompt
    };

    // If we have document content, include it in the session attributes
    if (documentContent) {
      sessionAttributes.documentContent = documentContent.content.substring(0, 1000); // Truncate for session
      sessionAttributes.documentUploadDate = documentContent.uploadDate;
      sessionAttributes.documentTypeDetected = documentContent.type;
    }

    const command = new InvokeAgentCommand({
      ...agentInput,
      sessionAttributes,
      enableTrace: true
    });

    console.log('Invoking Document Agent for analysis:', {
      inputText: message.substring(0, 100) + '...',
      documentType: intentAnalysis.documentType,
      hasDocument: !!documentContent
    });

    const response = await bedrockAgent.send(command);
    
    let agentResponseText = '';
    let reasoningTrace = [];

    if (response.completion) {
      for await (const chunk of response.completion) {
        if (chunk.chunk && chunk.chunk.bytes) {
          const chunkText = new TextDecoder().decode(chunk.chunk.bytes);
          agentResponseText += chunkText;
        }
        
        if (chunk.trace) {
          reasoningTrace.push(chunk.trace);
        }
      }
    }

    return {
      response: agentResponseText || generateFallbackResponse(message, intentAnalysis, documentContent),
      reasoningTrace,
      agentUsed: true
    };

  } catch (error) {
    console.error('Document AgentCore error:', error);
    throw error;
  }
}

/**
 * Generate AI response using direct Bedrock model (fallback)
 */
async function generateAIResponse(message, systemPrompt, intentAnalysis, documentContent, userId) {
  try {
    let prompt = `${systemPrompt}

User Intent: ${intentAnalysis.intent}
Confidence: ${intentAnalysis.confidence}
Document Type: ${intentAnalysis.documentType}

User Message: "${message}"`;

    if (documentContent) {
      prompt += `

Document to Analyze:
Type: ${documentContent.type}
Upload Date: ${documentContent.uploadDate}
Content: ${documentContent.content.substring(0, 2000)}...`;
    }

    prompt += `\n\nPlease provide a helpful response based on the user's request and any document content provided.`;

    const command = new InvokeModelCommand({
      modelId: process.env.MODEL_ID || 'amazon.titan-text-express-v1',
      body: JSON.stringify({
        inputText: prompt,
        textGenerationConfig: {
          maxTokenCount: 1000,
          stopSequences: [],
          temperature: 0.7,
          topP: 0.9
        }
      }),
      contentType: 'application/json',
    });

    const response = await bedrock.send(command);
    const responseBody = JSON.parse(new TextDecoder().decode(response.body));
    
    return {
      response: responseBody.results[0].outputText
    };
  } catch (error) {
    console.log('Bedrock error:', error.message);
    throw error; // Let the caller handle the fallback
  }
}

/**
 * Generate fallback response when Bedrock is unavailable
 */
function generateFallbackResponse(message, intentAnalysis, documentContent) {
  const docType = intentAnalysis.documentType;
  
  switch (intentAnalysis.intent) {
    case 'uploadDocument':
      return `I'd be happy to help you analyze your ${docType}! Here's how to get the most from document analysis:\n\n📋 **Before Uploading:**\n- Ensure documents are clear and readable\n- Remove or redact sensitive personal information if needed\n- Supported formats: PDF, text documents, images of documents\n\n🔍 **What I Can Help With:**\n- Explain medical terminology in simple language\n- Summarize key findings and results\n- Highlight important values or abnormal results\n- Suggest questions to ask your healthcare provider\n- Organize and categorize your health documents\n\n⚠️ **Important Reminder:**\nDocument analysis is for educational purposes only. Always discuss results with your healthcare provider for medical interpretation and decisions.`;
      
    case 'explainResults':
      if (documentContent) {
        return `I can see you've uploaded a ${documentContent.type} from ${documentContent.uploadDate}. While I'm currently updating my analysis capabilities, here's how to understand your results:\n\n💡 **General Tips for Reading Medical Documents:**\n- Look for "Reference Range" or "Normal Range" values\n- Results outside the normal range are typically flagged\n- Pay attention to any notes or comments from healthcare providers\n- Consider trends over time rather than single results\n\n📋 **Next Steps:**\n- Prepare questions about any abnormal or concerning results\n- Ask your healthcare provider to explain findings in detail\n- Request printed explanations for complex results\n- Keep copies of all results for your records`;
      } else {
        return `I'd be happy to help explain your ${docType}! To provide the best explanation:\n\n📄 **For Better Analysis:**\n- Upload the document you'd like me to review\n- Specify which parts you'd like me to focus on\n- Let me know what specific values or terms confuse you\n\n🏥 **Common Elements in Medical Documents:**\n- Reference ranges (normal values)\n- Abnormal results (usually flagged)\n- Provider notes and recommendations\n- Follow-up instructions\n\nAlways discuss results with your healthcare provider for personalized interpretation.`;
    }
      
    case 'summarizeDocument':
      if (documentContent) {
        return `Here's a general approach to summarizing your ${documentContent.type}:\n\n📊 **Key Elements to Focus On:**\n- Main test results and their normal ranges\n- Any abnormal or flagged values\n- Healthcare provider notes or recommendations\n- Follow-up instructions or next steps\n- Dates and trends if comparing multiple results\n\n💡 **Creating Your Own Summary:**\n- List abnormal results with their values\n- Note any provider recommendations\n- Track changes from previous tests\n- Prepare questions for your next appointment\n\nWould you like me to help you identify specific values or sections to focus on?`;
      } else {
        return `I can help summarize your ${docType} once you upload it! Here's what I typically include in document summaries:\n\n📋 **Summary Components:**\n- Key test results and findings\n- Normal vs. abnormal values\n- Important trends or changes\n- Provider recommendations\n- Follow-up requirements\n\n🎯 **To Get Started:**\n- Upload your document\n- Let me know if you want me to focus on specific sections\n- Specify if you're comparing with previous results`;
      }
      
    case 'questionPrep':
      return `Great idea to prepare questions for your healthcare provider! Here are some effective approaches:\n\n❓ **Good Questions to Ask:**\n- "What do these results mean for my health?"\n- "Are there any results that concern you?"\n- "How do these compare to my previous results?"\n- "What follow-up tests or treatments do you recommend?"\n- "Are there lifestyle changes I should consider?"\n\n📝 **Preparation Tips:**\n- Write questions down before your appointment\n- Bring copies of all relevant documents\n- Ask for written summaries of important information\n- Request clarification on medical terms you don't understand\n- Discuss any symptoms or concerns related to the results\n\n💡 **Document-Specific Questions:**\nFor ${docType}, also consider asking about normal ranges, trending patterns, and any preventive measures based on your results.`;
      
    default:
      return `I'm here to help you understand and organize your health documents! Here's what I can assist with:\n\n📄 **Document Analysis Services:**\n- Explain medical terminology in simple language\n- Summarize key findings from test results\n- Help organize and categorize health documents\n- Suggest questions for healthcare provider discussions\n- Compare results over time to identify trends\n\n🔧 **How to Get Started:**\n- Upload documents you'd like me to analyze\n- Ask specific questions about test results or medical terms\n- Request help preparing for healthcare appointments\n- Ask for guidance on organizing your health records\n\n⚠️ **Important Note:**\nAll document analysis is for educational purposes only. Always consult with your healthcare providers for medical interpretation and decisions.\n\nWhat specific document or health record would you like help with today?`;
  }
}
