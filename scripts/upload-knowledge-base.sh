#!/bin/bash

# Enabl Health Knowledge Base Upload Script
# Upload medical documents to S3 bucket for RAG processing

set -e

# Configuration
BUCKET_NAME="enabl-global-health-kb-development"
REGION="us-east-1"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🏥 Enabl Health Knowledge Base Upload Tool${NC}"
echo "=================================================="

# Function to upload a single file
upload_file() {
    local file_path="$1"
    local category="$2"
    
    if [ ! -f "$file_path" ]; then
        echo -e "${RED}❌ File not found: $file_path${NC}"
        return 1
    fi
    
    # Get filename
    filename=$(basename "$file_path")
    
    # Upload to S3
    echo -e "${YELLOW}📤 Uploading: $filename to $category/${NC}"
    
    aws s3 cp "$file_path" "s3://$BUCKET_NAME/$category/$filename" \
        --region "$REGION" \
        --metadata "source=enabl-upload,category=$category,uploaded=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✅ Successfully uploaded: $filename${NC}"
    else
        echo -e "${RED}❌ Failed to upload: $filename${NC}"
        return 1
    fi
}

# Function to upload a directory
upload_directory() {
    local dir_path="$1"
    local category="$2"
    
    if [ ! -d "$dir_path" ]; then
        echo -e "${RED}❌ Directory not found: $dir_path${NC}"
        return 1
    fi
    
    echo -e "${YELLOW}📁 Uploading directory: $dir_path to $category/${NC}"
    
    aws s3 sync "$dir_path" "s3://$BUCKET_NAME/$category/" \
        --region "$REGION" \
        --exclude "*.DS_Store" \
        --exclude "*.git/*" \
        --exclude "*.tmp"
    
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✅ Successfully synced directory: $dir_path${NC}"
    else
        echo -e "${RED}❌ Failed to sync directory: $dir_path${NC}"
        return 1
    fi
}

# Function to list bucket contents
list_contents() {
    echo -e "${BLUE}📋 Current Knowledge Base Contents:${NC}"
    aws s3 ls "s3://$BUCKET_NAME" --recursive --human-readable --summarize
}

# Function to show help
show_help() {
    echo "Usage: $0 [command] [options]"
    echo ""
    echo "Commands:"
    echo "  upload-file <file_path> <category>    Upload a single file"
    echo "  upload-dir <dir_path> <category>      Upload an entire directory"
    echo "  list                                  List all files in knowledge base"
    echo "  help                                  Show this help message"
    echo ""
    echo "Categories:"
    echo "  medical-guidelines                    FDA, WHO, CDC guidelines"
    echo "  regional-healthcare/australia         NDIS, Medicare guidelines"
    echo "  regional-healthcare/india             Geriatric care, Ayush protocols"
    echo "  regional-healthcare/usa               Healthcare.gov, Medicare/Medicaid"
    echo "  regional-healthcare/eu                European health directives"
    echo "  research-papers                       Scientific research, clinical studies"
    echo "  document-templates                    Medical forms, templates"
    echo ""
    echo "Examples:"
    echo "  $0 upload-file ./who-guidelines.pdf medical-guidelines"
    echo "  $0 upload-dir ./australia-docs regional-healthcare/australia"
    echo "  $0 list"
}

# Main script logic
case "$1" in
    "upload-file")
        if [ $# -ne 3 ]; then
            echo -e "${RED}❌ Error: upload-file requires file_path and category${NC}"
            show_help
            exit 1
        fi
        upload_file "$2" "$3"
        ;;
    "upload-dir")
        if [ $# -ne 3 ]; then
            echo -e "${RED}❌ Error: upload-dir requires dir_path and category${NC}"
            show_help
            exit 1
        fi
        upload_directory "$2" "$3"
        ;;
    "list")
        list_contents
        ;;
    "help"|"--help"|"-h")
        show_help
        ;;
    *)
        echo -e "${RED}❌ Unknown command: $1${NC}"
        show_help
        exit 1
        ;;
esac

echo ""
echo -e "${GREEN}🎉 Knowledge base operation completed!${NC}"
echo -e "${BLUE}💡 Tip: Files will be automatically indexed by Bedrock Knowledge Base within 15 minutes${NC}"
