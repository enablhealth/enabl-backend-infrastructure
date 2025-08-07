"""
Enabl Health Assistant AI Agent (Python)

Handles general health questions, symptom guidance, and wellness information.
Provides evidence-based health information while encouraging professional medical consultation.

Built for AWS Bedrock AgentCore compatibility with Python runtime.
"""

import json
import logging
import boto3
from typing import Dict, Any, Optional
from datetime import datetime

# Configure logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Initialize Bedrock clients
bedrock_runtime = boto3.client('bedrock-runtime', region_name='us-east-1')

def analyze_health_intent(message: str) -> Dict[str, Any]:
    """
    Analyze the user's message to determine health inquiry type
    
    Args:
        message: User's health-related message
        
    Returns:
        Dictionary with intent analysis
    """
    message_lower = message.lower()
    
    # Define health intent categories
    intents = {
        'emergency': ['emergency', 'urgent', 'severe pain', 'chest pain', 'difficulty breathing', 'unconscious'],
        'symptoms': ['symptom', 'pain', 'ache', 'fever', 'headache', 'dizzy', 'nausea', 'cough'],
        'mental_health': ['anxiety', 'depression', 'stress', 'mental health', 'mood', 'sleep'],
        'nutrition': ['diet', 'nutrition', 'food', 'eating', 'vitamin', 'supplement'],
        'exercise': ['exercise', 'workout', 'fitness', 'activity', 'movement'],
        'prevention': ['prevent', 'screening', 'checkup', 'vaccine', 'immunization'],
        'medication': ['medication', 'drug', 'prescription', 'pill', 'dosage'],
        'general': ['health', 'wellness', 'advice', 'information']
    }
    
    detected_intents = []
    for intent, keywords in intents.items():
        if any(keyword in message_lower for keyword in keywords):
            detected_intents.append(intent)
    
    return {
        'primary_intent': detected_intents[0] if detected_intents else 'general',
        'all_intents': detected_intents,
        'is_emergency': 'emergency' in detected_intents,
        'requires_professional_care': any(intent in detected_intents for intent in ['emergency', 'symptoms', 'medication'])
    }

def get_health_response(message: str, intent_analysis: Dict[str, Any], user_context: Optional[Dict] = None) -> str:
    """
    Generate health assistant response using Bedrock
    
    Args:
        message: User's message
        intent_analysis: Analysis of the health intent
        user_context: Optional user context
        
    Returns:
        Health assistant response
    """
    # Build system prompt based on intent
    system_prompt = """You are the Enabl Health Assistant, a HIPAA-compliant AI health advisor.
    
Your capabilities:
- Provide evidence-based health information and wellness guidance
- Analyze symptoms and suggest when to seek medical care
- Offer mental health support and stress management tips
- Provide nutrition and exercise guidance
- Explain medical terminology and concepts
- Guide users on preventive health measures

Guidelines:
- Always remind users you're not a substitute for professional medical advice
- For urgent symptoms, immediately advise seeking medical attention
- Provide balanced, evidence-based information from reputable sources
- Be empathetic and supportive while maintaining professional boundaries
- Focus on general wellness and prevention
- Avoid diagnosing or prescribing treatments
- Include clear disclaimers about medical advice limitations

Important: For medical emergencies, always advise users to call emergency services immediately."""

    # Add intent-specific guidance
    if intent_analysis['is_emergency']:
        system_prompt += "\n\nIMPORTANT: This appears to be a potential medical emergency. Prioritize advising immediate medical attention."
    
    if intent_analysis['requires_professional_care']:
        system_prompt += "\n\nNote: This inquiry may require professional medical evaluation. Include guidance on when and how to seek appropriate care."

    # Prepare the prompt for Amazon Nova Pro
    prompt = f"{system_prompt}\n\nUser Question: {message}\n\nHealth Assistant Response:"
    
    # Create the request body
    body = json.dumps({
        "messages": [{
            "role": "user",
            "content": [{"text": prompt}]
        }],
        "inferenceConfig": {
            "maxTokens": 800,
            "temperature": 0.7,
            "topP": 0.9
        }
    })

    try:
        response = bedrock_runtime.invoke_model(
            modelId='amazon.nova-pro-v1:0',
            body=body,
            contentType="application/json",
            accept="application/json"
        )
        
        response_body = json.loads(response['body'].read())
        logger.info(f"Health Assistant Nova response received")
        
        # Extract text from Amazon Nova Pro response
        if 'output' in response_body and 'message' in response_body['output']:
            content = response_body['output']['message']['content']
            if isinstance(content, list) and len(content) > 0:
                return content[0]['text']
            elif isinstance(content, str):
                return content
        elif 'outputText' in response_body:
            return response_body['outputText']
        else:
            logger.warning(f"Unexpected Nova response format: {response_body}")
            return "I'm here to help with your health questions. Could you please rephrase your question?"
        
    except Exception as e:
        logger.error(f"Health Assistant Nova error: {e}")
        return "I apologize, but I'm unable to process your health question at the moment. Please try again or consult a healthcare professional if urgent."

def handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    AWS Lambda handler for Health Assistant Agent
    
    Args:
        event: Lambda event containing the health question
        context: Lambda context
        
    Returns:
        Health assistant response
    """
    try:
        # Parse the incoming request
        if isinstance(event.get('body'), str):
            body = json.loads(event['body'])
        else:
            body = event.get('body', {})
        
        message = body.get('message', '')
        user_id = body.get('userId', 'anonymous')
        session_id = body.get('sessionId', f"session-{int(datetime.now().timestamp())}")
        user_context = body.get('context', {})
        
        logger.info(f"Health Assistant request - User: {user_id}, Session: {session_id}, Message length: {len(message)}")
        
        if not message:
            return {
                'statusCode': 400,
                'headers': {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                },
                'body': json.dumps({
                    'error': 'Message is required',
                    'agent': 'health-assistant'
                })
            }
        
        # Analyze the health intent
        intent_analysis = analyze_health_intent(message)
        logger.info(f"Health intent analysis: {intent_analysis}")
        
        # Generate response
        response_text = get_health_response(message, intent_analysis, user_context)
        
        # Prepare the response
        response_data = {
            'response': response_text,
            'agent': 'health-assistant',
            'sessionId': session_id,
            'timestamp': datetime.now().isoformat(),
            'intent_analysis': intent_analysis,
            'source': 'enabl-health-assistant-python'
        }
        
        return {
            'statusCode': 200,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            'body': json.dumps(response_data)
        }
        
    except Exception as e:
        logger.error(f"Health Assistant error: {str(e)}")
        return {
            'statusCode': 500,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            'body': json.dumps({
                'error': 'Internal server error',
                'agent': 'health-assistant',
                'timestamp': datetime.now().isoformat()
            })
        }
