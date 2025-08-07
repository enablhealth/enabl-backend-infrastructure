"""
Enabl Appointment Agent (Python)

Handles appointment scheduling, calendar integration, and healthcare appointment management.
Integrates with Google Calendar, Apple Calendar, and other scheduling systems.

Built for AWS Bedrock AgentCore compatibility with Python runtime.
"""

import json
import logging
import boto3
from typing import Dict, Any, Optional, List
from datetime import datetime, timedelta
import re

# Configure logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Initialize Bedrock clients
bedrock_runtime = boto3.client('bedrock-runtime', region_name='us-east-1')

def analyze_appointment_intent(message: str) -> Dict[str, Any]:
    """
    Analyze the user's message to determine appointment intent
    
    Args:
        message: User's appointment-related message
        
    Returns:
        Dictionary with intent analysis
    """
    message_lower = message.lower()
    
    # Define appointment intent categories
    intents = {
        'schedule': ['schedule', 'book', 'make appointment', 'set up', 'arrange'],
        'reschedule': ['reschedule', 'change', 'move', 'modify', 'update'],
        'cancel': ['cancel', 'delete', 'remove', 'cancel appointment'],
        'check': ['check', 'view', 'show', 'list', 'upcoming', 'next'],
        'availability': ['available', 'free', 'open', 'slots', 'times'],
        'reminder': ['remind', 'notification', 'alert', 'reminder'],
        'urgent': ['urgent', 'emergency', 'asap', 'today', 'immediately']
    }
    
    # Extract appointment types
    appointment_types = {
        'general': ['doctor', 'physician', 'gp', 'general practitioner'],
        'specialist': ['specialist', 'cardiologist', 'dermatologist', 'neurologist'],
        'dental': ['dentist', 'dental', 'teeth', 'oral'],
        'vision': ['eye', 'optometrist', 'vision', 'glasses'],
        'mental_health': ['therapist', 'psychiatrist', 'counselor', 'mental health'],
        'physical_therapy': ['physical therapy', 'pt', 'physiotherapy'],
        'lab': ['lab', 'blood test', 'x-ray', 'scan', 'imaging']
    }
    
    # Extract time references
    time_references = {
        'today': ['today'],
        'tomorrow': ['tomorrow'],
        'this_week': ['this week', 'next few days'],
        'next_week': ['next week'],
        'specific_date': r'\d{1,2}\/\d{1,2}|\d{1,2}-\d{1,2}|january|february|march|april|may|june|july|august|september|october|november|december'
    }
    
    detected_intents = []
    for intent, keywords in intents.items():
        if any(keyword in message_lower for keyword in keywords):
            detected_intents.append(intent)
    
    detected_types = []
    for apt_type, keywords in appointment_types.items():
        if any(keyword in message_lower for keyword in keywords):
            detected_types.append(apt_type)
    
    detected_times = []
    for time_ref, keywords in time_references.items():
        if time_ref == 'specific_date':
            if re.search(keywords, message_lower):
                detected_times.append(time_ref)
        else:
            if any(keyword in message_lower for keyword in keywords):
                detected_times.append(time_ref)
    
    return {
        'primary_intent': detected_intents[0] if detected_intents else 'schedule',
        'all_intents': detected_intents,
        'appointment_types': detected_types,
        'time_references': detected_times,
        'is_urgent': 'urgent' in detected_intents,
        'needs_calendar_integration': any(intent in detected_intents for intent in ['schedule', 'reschedule', 'check'])
    }

def get_appointment_response(message: str, intent_analysis: Dict[str, Any], user_context: Optional[Dict] = None) -> str:
    """
    Generate appointment agent response using Bedrock
    
    Args:
        message: User's message
        intent_analysis: Analysis of the appointment intent
        user_context: Optional user context
        
    Returns:
        Appointment agent response
    """
    # Build system prompt based on intent
    system_prompt = """You are the Enabl Appointment Agent, specialized in healthcare scheduling and appointment management.

Your capabilities:
- Schedule, reschedule, and cancel medical appointments
- Check appointment availability and manage calendars
- Integrate with Google Calendar, Apple Calendar, and healthcare systems
- Provide appointment reminders and notifications
- Handle urgent appointment requests
- Manage waitlists and priority scheduling
- Connect with healthcare providers and scheduling systems

Available appointment types:
- General practitioner/family doctor visits
- Specialist consultations (cardiology, dermatology, etc.)
- Dental appointments
- Vision/eye care
- Mental health (therapy, psychiatry)
- Physical therapy
- Lab tests and imaging

Scheduling capabilities:
- Same-day urgent appointments
- Regular scheduling (1-4 weeks out)
- Recurring appointments
- Telehealth/virtual appointments
- In-person visits

Integration features:
- Google Calendar sync
- Apple Calendar sync
- Healthcare provider portals
- Insurance verification
- Appointment confirmations and reminders

Guidelines:
- Always confirm appointment details before booking
- Verify insurance coverage when possible
- Provide clear appointment instructions and preparation info
- Offer multiple time slots when available
- Handle cancellations with rebooking options
- Prioritize urgent medical needs appropriately"""

    # Add intent-specific guidance
    if intent_analysis['is_urgent']:
        system_prompt += "\n\nIMPORTANT: This appears to be an urgent appointment request. Prioritize same-day or emergency scheduling options."
    
    if intent_analysis['needs_calendar_integration']:
        system_prompt += "\n\nNote: This request involves calendar integration. Mention available calendar sync options and integration steps."

    # Prepare the prompt for Amazon Nova Pro
    prompt = f"{system_prompt}\n\nUser Request: {message}\n\nAppointment Agent Response:"
    
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
        logger.info(f"Appointment Agent Nova response received")
        
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
            return "I'm here to help you with appointment scheduling. Could you please clarify what type of appointment you need?"
        
    except Exception as e:
        logger.error(f"Appointment Agent Nova error: {e}")
        return "I apologize, but I'm unable to process your appointment request at the moment. Please try again or contact your healthcare provider directly."

def handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    AWS Lambda handler for Appointment Agent
    
    Args:
        event: Lambda event containing the appointment request
        context: Lambda context
        
    Returns:
        Appointment agent response
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
        
        logger.info(f"Appointment Agent request - User: {user_id}, Session: {session_id}, Message length: {len(message)}")
        
        if not message:
            return {
                'statusCode': 400,
                'headers': {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                },
                'body': json.dumps({
                    'error': 'Message is required',
                    'agent': 'appointment-agent'
                })
            }
        
        # Analyze the appointment intent
        intent_analysis = analyze_appointment_intent(message)
        logger.info(f"Appointment intent analysis: {intent_analysis}")
        
        # Generate response
        response_text = get_appointment_response(message, intent_analysis, user_context)
        
        # Prepare the response
        response_data = {
            'response': response_text,
            'agent': 'appointment-agent',
            'sessionId': session_id,
            'timestamp': datetime.now().isoformat(),
            'intent_analysis': intent_analysis,
            'source': 'enabl-appointment-agent-python'
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
        logger.error(f"Appointment Agent error: {str(e)}")
        return {
            'statusCode': 500,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            'body': json.dumps({
                'error': 'Internal server error',
                'agent': 'appointment-agent',
                'timestamp': datetime.now().isoformat()
            })
        }
