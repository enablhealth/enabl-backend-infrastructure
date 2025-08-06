#!/bin/bash

# Enabl Health Infrastructure Deployment Script
# This script handles the deployment of AWS infrastructure using CDK

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Function to check prerequisites
check_prerequisites() {
    print_status "Checking prerequisites..."
    
    # Check if AWS CLI is installed
    if ! command -v aws &> /dev/null; then
        print_error "AWS CLI is not installed. Please install it first."
        exit 1
    fi
    
    # Check if CDK is installed
    if ! command -v cdk &> /dev/null; then
        print_error "AWS CDK is not installed. Please install it: npm install -g aws-cdk"
        exit 1
    fi
    
    # Check if Node.js is installed
    if ! command -v node &> /dev/null; then
        print_error "Node.js is not installed. Please install Node.js 18+"
        exit 1
    fi
    
    # Check Node.js version
    NODE_VERSION=$(node -v | cut -d'.' -f1 | cut -d'v' -f2)
    if [ "$NODE_VERSION" -lt 18 ]; then
        print_error "Node.js version 18+ is required. Current version: $(node -v)"
        exit 1
    fi
    
    print_success "All prerequisites are met"
}

# Function to validate AWS credentials
validate_aws_credentials() {
    print_status "Validating AWS credentials..."
    
    if ! aws sts get-caller-identity &> /dev/null; then
        print_error "AWS credentials not configured or invalid"
        print_status "Please run: aws configure"
        exit 1
    fi
    
    ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
    # Default to us-east-1 for global users, allow override via AWS CLI config
    REGION=$(aws configure get region 2>/dev/null || echo "us-east-1")
    
    print_success "AWS credentials valid"
    print_status "Account ID: $ACCOUNT_ID"
    print_status "Region: $REGION (optimized for global users)"
}

# Function to install dependencies
install_dependencies() {
    print_status "Installing dependencies..."
    npm ci
    print_success "Dependencies installed"
}

# Function to run tests
run_tests() {
    print_status "Running tests..."
    npm test
    print_success "All tests passed"
}

# Function to lint code
lint_code() {
    print_status "Running linter..."
    npm run lint
    print_success "Code linting passed"
}

# Function to bootstrap CDK
bootstrap_cdk() {
    local region=$1
    print_status "Bootstrapping CDK in region $region..."
    cdk bootstrap "aws://$ACCOUNT_ID/$region"
    print_success "CDK bootstrapped"
}

# Function to deploy stack
deploy_stack() {
    local environment=$1
    local auto_approve=${2:-false}
    
    print_status "Deploying Enabl Health infrastructure for $environment environment..."
    
    if [ "$auto_approve" = true ]; then
        cdk deploy --context environment="$environment" --require-approval never
    else
        cdk deploy --context environment="$environment"
    fi
    
    print_success "Deployment completed for $environment environment"
}

# Function to get stack outputs
get_outputs() {
    local environment=$1
    local stack_name="EnablBackend-$environment"
    
    print_status "Getting stack outputs for $environment..."
    
    aws cloudformation describe-stacks \
        --stack-name "$stack_name" \
        --query "Stacks[0].Outputs" \
        --output table
}

# Function to show help
show_help() {
    echo "Enabl Health Infrastructure Deployment"
    echo ""
    echo "Usage: $0 [COMMAND] [OPTIONS]"
    echo ""
    echo "Commands:"
    echo "  deploy <env>     Deploy infrastructure (env: dev, staging, prod)"
    echo "  destroy <env>    Destroy infrastructure"
    echo "  diff <env>       Show differences"
    echo "  outputs <env>    Show stack outputs"
    echo "  bootstrap        Bootstrap CDK"
    echo "  test             Run tests"
    echo "  lint             Run linter"
    echo "  help             Show this help"
    echo ""
    echo "Options:"
    echo "  --auto-approve   Skip confirmation prompts"
    echo "  --skip-tests     Skip running tests"
    echo ""
    echo "Examples:"
    echo "  $0 deploy dev"
    echo "  $0 deploy prod --auto-approve"
    echo "  $0 destroy staging"
    echo "  $0 outputs prod"
}

# Main function
main() {
    local command=${1:-help}
    local environment=${2:-}
    local auto_approve=false
    local skip_tests=false
    
    # Parse options
    shift 2 2>/dev/null || shift $# # Remove first two args or all if less than 2
    while [[ $# -gt 0 ]]; do
        case $1 in
            --auto-approve)
                auto_approve=true
                shift
                ;;
            --skip-tests)
                skip_tests=true
                shift
                ;;
            *)
                print_error "Unknown option: $1"
                show_help
                exit 1
                ;;
        esac
    done
    
    case $command in
        deploy)
            if [ -z "$environment" ]; then
                print_error "Environment is required for deploy command"
                show_help
                exit 1
            fi
            
            check_prerequisites
            validate_aws_credentials
            install_dependencies
            
            if [ "$skip_tests" != true ]; then
                run_tests
                lint_code
            fi
            
            deploy_stack "$environment" "$auto_approve"
            get_outputs "$environment"
            ;;
        destroy)
            if [ -z "$environment" ]; then
                print_error "Environment is required for destroy command"
                show_help
                exit 1
            fi
            
            check_prerequisites
            validate_aws_credentials
            
            print_warning "This will destroy all resources in $environment environment!"
            if [ "$auto_approve" != true ]; then
                read -p "Are you sure? (y/N): " -n 1 -r
                echo
                if [[ ! $REPLY =~ ^[Yy]$ ]]; then
                    print_status "Deployment cancelled"
                    exit 0
                fi
            fi
            
            cdk destroy --context environment="$environment" --force
            print_success "Stack destroyed"
            ;;
        diff)
            if [ -z "$environment" ]; then
                print_error "Environment is required for diff command"
                show_help
                exit 1
            fi
            
            check_prerequisites
            validate_aws_credentials
            install_dependencies
            
            cdk diff --context environment="$environment"
            ;;
        outputs)
            if [ -z "$environment" ]; then
                print_error "Environment is required for outputs command"
                show_help
                exit 1
            fi
            
            validate_aws_credentials
            get_outputs "$environment"
            ;;
        bootstrap)
            check_prerequisites
            validate_aws_credentials
            
            # Default to us-east-1 for global users if no region is configured
            REGION=${REGION:-"us-east-1"}
            bootstrap_cdk "$REGION"
            ;;
        test)
            check_prerequisites
            install_dependencies
            run_tests
            ;;
        lint)
            check_prerequisites
            install_dependencies
            lint_code
            ;;
        help)
            show_help
            ;;
        *)
            print_error "Unknown command: $command"
            show_help
            exit 1
            ;;
    esac
}

# Run main function with all arguments
main "$@"
