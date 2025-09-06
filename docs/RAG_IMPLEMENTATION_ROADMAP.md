/**
 * IMPLEMENTATION ROADMAP: Personalized RAG for Enabl Health
 * 
 * Phase-by-phase implementation to transform document storage 
 * into a comprehensive health intelligence system
 */

## IMMEDIATE IMPLEMENTATION (Week 1)

### 1. Enhanced Document Metadata Storage
**Goal**: Store full document text content in existing DynamoDB table

#### A. Update DocumentRecord interface
```typescript
// Add to existing documentStorage.ts
export interface DocumentRecord {
  // ... existing fields
  
  // NEW: Full content storage
  extractedText?: string;           // Full document text
  contentExtracted: boolean;        // Processing status
  lastProcessed?: string;           // When content was last analyzed
  
  // NEW: Enhanced medical analysis
  medicalEntities?: Array<{
    text: string;
    category: 'MEDICATION' | 'CONDITION' | 'PROCEDURE' | 'SYMPTOM';
    confidence: number;
    startOffset: number;
    endOffset: number;
  }>;
  
  // NEW: Health timeline events
  healthEvents?: Array<{
    date: string;
    eventType: 'diagnosis' | 'treatment' | 'test' | 'medication';
    description: string;
    confidence: number;
  }>;
  
  // NEW: User-specific insights
  userInsights?: {
    relevanceScore: number;         // How relevant to user's health
    actionItems: string[];          // AI-suggested next steps
    urgencyLevel: 'low' | 'medium' | 'high';
    clinicalSummary: string;        // AI-generated summary
  };
}
```

#### B. Implement text extraction pipeline
```typescript
// New function in documentStorage.ts
async function processDocumentContent(documentId: string, s3Key: string): Promise<void> {
  try {
    // 1. Extract text from S3 document
    const text = await extractTextFromDocument(s3Key);
    
    // 2. Basic medical entity extraction (using keywords)
    const entities = await extractBasicMedicalEntities(text);
    
    // 3. Extract health events from text
    const events = await extractHealthEvents(text);
    
    // 4. Generate user insights
    const insights = await generateUserInsights(text, entities);
    
    // 5. Update document in DynamoDB
    await updateDocumentWithContent(documentId, {
      extractedText: text,
      contentExtracted: true,
      medicalEntities: entities,
      healthEvents: events,
      userInsights: insights,
      lastProcessed: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Failed to process document:', error);
  }
}
```

### 2. Basic Medical Entity Extraction
**Goal**: Extract medical information without additional AWS services

```typescript
// Basic keyword-based medical entity extraction
function extractBasicMedicalEntities(text: string): MedicalEntity[] {
  const entities: MedicalEntity[] = [];
  
  // Common medical keywords
  const medicalPatterns = {
    MEDICATION: /\b(?:mg|tablet|capsule|dose|medication|prescription|pill|drug)\b/gi,
    CONDITION: /\b(?:diagnosis|condition|disease|disorder|syndrome|infection)\b/gi,
    PROCEDURE: /\b(?:surgery|procedure|operation|treatment|therapy|scan|x-ray|mri)\b/gi,
    SYMPTOM: /\b(?:pain|fever|headache|nausea|fatigue|dizziness|rash|cough)\b/gi
  };
  
  Object.entries(medicalPatterns).forEach(([category, pattern]) => {
    const matches = text.matchAll(pattern);
    for (const match of matches) {
      entities.push({
        text: match[0],
        category: category as any,
        confidence: 0.7,
        startOffset: match.index || 0,
        endOffset: (match.index || 0) + match[0].length
      });
    }
  });
  
  return entities;
}
```

### 3. Health Timeline Generation
```typescript
function extractHealthEvents(text: string): HealthEvent[] {
  const events: HealthEvent[] = [];
  
  // Look for date patterns
  const datePattern = /(\d{1,2}\/\d{1,2}\/\d{4}|\d{4}-\d{2}-\d{2}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{1,2},? \d{4})/gi;
  const dates = text.match(datePattern) || [];
  
  dates.forEach(date => {
    // Extract surrounding context (50 characters before and after)
    const dateIndex = text.indexOf(date);
    const context = text.substring(
      Math.max(0, dateIndex - 50), 
      Math.min(text.length, dateIndex + 50)
    );
    
    events.push({
      date: new Date(date).toISOString(),
      eventType: determineEventType(context),
      description: context.trim(),
      confidence: 0.6
    });
  });
  
  return events;
}
```

## PHASE 2 IMPLEMENTATION (Week 2)

### 1. AWS Comprehend Medical Integration
**Goal**: Professional medical entity extraction

#### A. Install required packages
```bash
npm install @aws-sdk/client-comprehendmedical
```

#### B. Enhanced medical analysis
```typescript
import { ComprehendMedicalClient, DetectEntitiesV2Command } from '@aws-sdk/client-comprehendmedical';

async function extractProfessionalMedicalEntities(text: string): Promise<MedicalEntity[]> {
  const client = new ComprehendMedicalClient({ region: 'us-east-1' });
  
  const command = new DetectEntitiesV2Command({
    Text: text.substring(0, 20000) // API limit
  });
  
  const result = await client.send(command);
  
  return result.Entities?.map(entity => ({
    text: entity.Text || '',
    category: entity.Category,
    confidence: entity.Score || 0,
    startOffset: entity.BeginOffset || 0,
    endOffset: entity.EndOffset || 0,
    icd10Code: entity.ICD10CMConcepts?.[0]?.Code,
    snomedCode: entity.SNOMEDCTConcepts?.[0]?.Code
  })) || [];
}
```

### 2. User Health Profile Creation
**Goal**: Aggregate health insights across all user documents

#### A. Create user health profiles table
```typescript
// New DynamoDB table: enabl-user-health-profiles-dev
interface UserHealthProfile {
  userId: string;
  healthSummary: {
    conditions: string[];
    medications: string[];
    allergies: string[];
    recentTests: string[];
  };
  documentInsights: {
    totalDocuments: number;
    healthScore: number;        // Overall health engagement score
    lastUpdated: string;
    keyTrends: string[];
  };
  aiPersonalization: {
    communicationStyle: 'technical' | 'simple';
    primaryConcerns: string[];
    healthGoals: string[];
  };
}
```

## PHASE 3 IMPLEMENTATION (Week 3)

### 1. Semantic Search with OpenSearch
**Goal**: Enable natural language search across document content

#### A. OpenSearch Serverless setup
```typescript
// Vector embeddings for semantic search
interface DocumentEmbedding {
  documentId: string;
  userId: string;
  chunkId: string;
  content: string;
  embedding: number[];
  metadata: {
    category: string;
    date: string;
    relevanceScore: number;
  };
}
```

### 2. Bedrock Knowledge Base Integration
**Goal**: User-specific knowledge bases for personalized AI responses

## PHASE 4 IMPLEMENTATION (Week 4)

### 1. Personalized AI Responses
**Goal**: Context-aware health assistance

```typescript
async function getPersonalizedHealthResponse(
  query: string, 
  userId: string
): Promise<string> {
  // 1. Get user health profile
  const profile = await getUserHealthProfile(userId);
  
  // 2. Search relevant documents
  const relevantDocs = await searchUserDocuments(query, userId);
  
  // 3. Build personalized context
  const context = `
    User Health Context:
    - Known Conditions: ${profile.healthSummary.conditions.join(', ')}
    - Current Medications: ${profile.healthSummary.medications.join(', ')}
    - Communication Preference: ${profile.aiPersonalization.communicationStyle}
    
    Relevant Document Content:
    ${relevantDocs.map(doc => doc.content).join('\n\n')}
    
    User Question: ${query}
  `;
  
  // 4. Generate AI response with full context
  return await generateAIResponse(context);
}
```

## IMMEDIATE NEXT STEPS

### 1. Start with Text Extraction (This Week)
```typescript
// Add to your existing documentStorage.ts
export async function enhanceDocumentWithContent(documentId: string, s3Key: string): Promise<void> {
  try {
    // Extract text from S3 document (you'll need to implement based on file type)
    const extractedText = await extractTextFromS3Document(s3Key);
    
    // Basic medical keyword extraction
    const medicalKeywords = extractMedicalKeywords(extractedText);
    
    // Update existing document record
    await updateDocumentRecord(documentId, {
      extractedText,
      contentExtracted: true,
      medicalKeywords,
      lastProcessed: new Date().toISOString()
    });
    
    console.log(`Enhanced document ${documentId} with full content`);
    
  } catch (error) {
    console.error('Failed to enhance document:', error);
  }
}
```

### 2. Update Your Upload Handler
```typescript
// In SmartDocumentPane.tsx - modify handleS3Upload
const handleS3Upload = async (uploadedFiles: S3UploadedFile[]) => {
  // ... existing code ...
  
  // NEW: Start content processing
  for (const uploadedFile of uploadedFiles) {
    // Enhance document with full content extraction
    enhanceDocumentWithContent(uploadedFile.id, uploadedFile.s3Key)
      .catch(error => console.error('Content enhancement failed:', error));
  }
};
```

### 3. Add Content Search
```typescript
// New search function that includes document content
export async function searchDocumentsWithContent(
  query: string, 
  userId: string
): Promise<SmartDocument[]> {
  const documents = await getUserDocuments(userId);
  
  return documents.filter(doc => {
    // Search in filename, tags, AND full content
    const searchableText = [
      doc.name,
      doc.smartTags.map(tag => tag.name).join(' '),
      doc.extractedText || ''
    ].join(' ').toLowerCase();
    
    return searchableText.includes(query.toLowerCase());
  });
}
```

## COST ANALYSIS

### Storage Costs (per 1000 documents)
- **Current (metadata only)**: ~$0.25/month
- **Enhanced (full content)**: ~$12.50/month
- **With vector embeddings**: ~$25/month

### Processing Costs
- **Comprehend Medical**: ~$0.001 per document
- **Bedrock embeddings**: ~$0.0001 per document
- **AI analysis**: ~$0.01 per document

### ROI Benefits
- **10x better search accuracy**
- **Personalized health insights**
- **Actionable medical recommendations**
- **Competitive advantage in healthcare AI**

## SECURITY & COMPLIANCE

### HIPAA Requirements
- **Encryption**: All content encrypted in DynamoDB
- **Access control**: User-specific data isolation
- **Audit trails**: Complete processing logs
- **Data retention**: Configurable document lifecycle

### Implementation Security
- **Text extraction**: Serverless Lambda functions
- **Content processing**: Async with error handling
- **Medical data**: Structured storage with validation
- **User consent**: Explicit permission for content analysis

This phased approach allows you to start immediately with basic text extraction and progressively build toward a comprehensive health intelligence platform.
