/**
 * Enabl Document AI Agent
 * 
 * Analyzes and answers questions about user-uploaded health documents,
 * medical reports, test results, and other health-related files.
 */

const { BedrockRuntimeClient, RetrieveAndGenerateCommand } = require('@aws-sdk/client-bedrock-runtime');
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');

const bedrock = new BedrockRuntimeClient({ region: process.env.REGION });
const s3 = new S3Client({ region: process.env.REGION });

exports.handler = async (event) => {
  try {
    const { message, userId, sessionId, context, documentId } = JSON.parse(event.body);
    
    console.log('Document Agent request:', { 
      userId, 
      sessionId, 
      documentId,
      messageLength: message?.length 
    });

    // System prompt for document agent
    const systemPrompt = `You are the Enabl Document Assistant, specializing in analyzing and explaining health documents, medical reports, and test results.

Your expertise:
- Interpret medical test results and lab reports
- Explain medical terminology in plain language
- Identify key health indicators and trends
- Provide context for medical findings
- Suggest follow-up questions for healthcare providers

Guidelines:
- Always emphasize that you provide information, not medical diagnosis
- Encourage users to discuss results with their healthcare providers
- Explain technical terms clearly
- Highlight important values or findings
- Respect patient privacy and confidentiality

Important: Never provide medical diagnoses or treatment recommendations. Focus on education and explanation.`;

    // If a specific document is referenced, include it in the context
    let documentContext = '';
    if (documentId) {
      try {
        // In production, this would retrieve and process the actual document
        documentContext = `\n\nDocument Analysis Context: Analyzing document ${documentId} for user ${userId}`;
      } catch (docError) {
        console.warn('Could not retrieve document:', docError);
      }
    }

    // Use Bedrock's retrieve and generate for document analysis
    const command = new RetrieveAndGenerateCommand({
      input: {
        text: message,
      },
      retrieveAndGenerateConfiguration: {
        type: 'KNOWLEDGE_BASE',
        knowledgeBaseConfiguration: {
          knowledgeBaseId: process.env.KNOWLEDGE_BASE_ID,
          modelArn: `arn:aws:bedrock:${process.env.REGION}::foundation-model/${process.env.MODEL_ID}`,
          retrievalConfiguration: {
            vectorSearchConfiguration: {
              numberOfResults: 3,
            },
          },
          generationConfiguration: {
            promptTemplate: {
              textPromptTemplate: `${systemPrompt}${documentContext}

Context from user documents:
$search_results$

User Question: $query$

Please analyze the information and provide a clear, educational explanation. Remember to encourage the user to discuss any findings with their healthcare provider.`
            },
          },
        },
      },
      sessionId: sessionId || `document-${userId}-${Date.now()}`,
    });

    const response = await bedrock.send(command);
    
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
      },
      body: JSON.stringify({
        response: response.output.text,
        agentType: 'document-agent',
        sessionId: response.sessionId,
        documentId: documentId || null,
        citations: response.citations || [],
        timestamp: new Date().toISOString(),
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
        error: 'Sorry, I had trouble analyzing your document. Please try again.',
        agentType: 'document-agent',
        timestamp: new Date().toISOString(),
      }),
    };
  }
};
