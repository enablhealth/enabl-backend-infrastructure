# Enabl Health Knowledge Base

This folder contains medical documents and resources that will be uploaded to AWS Bedrock Knowledge Base for RAG (Retrieval Augmented Generation) capabilities.

## Folder Structure

### 📋 `medical-guidelines/`
**Purpose**: Core medical protocols and guidelines
**Content Examples**:
- FDA drug approval guidelines
- WHO health protocols
- CDC disease prevention guidelines
- Medical procedure standards
- HIPAA compliance documents

### 🌍 `regional-healthcare/`
**Purpose**: Country/region-specific healthcare information
**Subfolders**:
- `australia/` - NDIS schemes, Medicare guidelines
- `india/` - Geriatric care protocols, Ayush integration
- `usa/` - Healthcare.gov, Medicare/Medicaid
- `eu/` - European health directives
- `uk/` - NHS protocols and guidelines

### 🔬 `research-papers/`
**Purpose**: Scientific research and clinical studies
**Content Examples**:
- Peer-reviewed medical journals
- Clinical trial results
- Medical research publications
- Evidence-based medicine studies
- Health technology assessments

### 📄 `document-templates/`
**Purpose**: Standard medical forms and templates
**Content Examples**:
- Medical history forms
- Lab result templates
- Prescription formats
- Appointment scheduling forms
- Insurance claim templates
- Compliance templates

## File Formats Supported
- **PDF**: Primary format for documents
- **TXT**: Plain text medical guidelines
- **DOCX**: Word documents (converted to PDF)
- **MD**: Markdown documentation

## Upload Instructions

### Local Development
1. Place files in appropriate folders
2. Sync to S3 using CDK deployment
3. Knowledge base will auto-index new content

### S3 Bucket Structure
```
enabl-global-health-kb-development/
├── medical-guidelines/
├── regional-healthcare/
│   ├── australia/
│   ├── india/
│   ├── usa/
│   └── eu/
├── research-papers/
└── document-templates/
```

## Agent Access Levels

| Agent | Medical Guidelines | Regional Healthcare | Research Papers | Document Templates |
|-------|-------------------|-------------------|-----------------|-------------------|
| **Health Assistant** | ✅ Full Access | ✅ Full Access | ✅ Read Only | ❌ Limited |
| **Community Agent** | ✅ Read Only | ✅ Full Access | ✅ Full Access | ❌ Limited |
| **Document Agent** | ✅ Full Access | ✅ Full Access | ✅ Full Access | ✅ Full Access |
| **Appointment Agent** | ❌ Limited | ✅ Scheduling Only | ❌ Limited | ✅ Forms Only |

## Adding New Content

1. **Categorize**: Determine which folder fits best
2. **Format**: Ensure PDF format for best indexing
3. **Name**: Use descriptive filenames (e.g., `fda-drug-approval-2024.pdf`)
4. **Deploy**: Run CDK deploy to sync to S3
5. **Index**: Knowledge base auto-indexes within 15 minutes

## Compliance Notes

- All documents should be publicly available or properly licensed
- No patient-specific information (PHI/PII)
- Follow HIPAA guidelines for any health-related content
- Verify licensing for research papers and guidelines

## Example Content Sources

### Medical Guidelines
- [FDA.gov](https://www.fda.gov) - Drug and device guidelines
- [WHO.int](https://www.who.int) - Global health standards
- [CDC.gov](https://www.cdc.gov) - Disease prevention protocols

### Regional Healthcare
- [NDIS.gov.au](https://www.ndis.gov.au) - Australia disability support
- [NHS.uk](https://www.nhs.uk) - UK healthcare guidelines
- [Healthcare.gov](https://www.healthcare.gov) - US health insurance

### Research Papers
- [PubMed](https://pubmed.ncbi.nlm.nih.gov) - Medical research database
- [Cochrane Library](https://www.cochranelibrary.com) - Systematic reviews
- [BMJ](https://www.bmj.com) - British Medical Journal

---

**Last Updated**: August 7, 2025  
**Maintained By**: Enabl Health Team
