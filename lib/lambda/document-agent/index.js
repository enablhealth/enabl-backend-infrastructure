const AWS = require('aws-sdk');

// Config
const REGION = process.env.AWS_REGION || 'us-east-1';
const DOCUMENTS_TABLE = process.env.DOCUMENTS_TABLE || 'enabl-documents-dev';
const DOCUMENTS_BUCKET = process.env.DOCUMENTS_BUCKET || 'enabl-documents-dev';
const UPLOADS_BUCKET = process.env.USER_UPLOADS_BUCKET || process.env.UPLOADS_BUCKET || DOCUMENTS_BUCKET || 'enabl-user-uploads-dev';
// We intentionally do NOT use a separate knowledge base bucket for extracted text in dev.
// All extracted text is read/written under the uploads bucket path: users/<userId>/documents/<documentId>.txt
const KNOWLEDGE_BASE_BUCKET = process.env.KNOWLEDGE_BASE_BUCKET || null;
const VECTOR_ENDPOINT = process.env.VECTOR_COLLECTION_ENDPOINT || process.env.VECTOR_ENDPOINT || null; // e.g., https://xxxx.aoss.amazonaws.com
const VECTOR_INDEX = process.env.VECTOR_INDEX || 'documents';
const VECTOR_DIM = Number(process.env.VECTOR_DIM || 1536);

// Initialize AWS v2 clients
AWS.config.update({ region: REGION });
const s3 = new AWS.S3();
const dynamodb = new AWS.DynamoDB();
let bedrockClient = null;
let textract = null;
try {
	if (AWS.BedrockRuntime) {
		bedrockClient = new AWS.BedrockRuntime();
	}
} catch (_) {
	bedrockClient = null;
}
try {
	if (AWS.Textract) {
		textract = new AWS.Textract();
	}
} catch (_) {
	textract = null;
}
async function headObjectSafe(bucket, key) {
	try {
		const res = await s3.headObject({ Bucket: bucket, Key: key }).promise();
		return res;
	} catch (e) {
		if (e && (e.code === 'NotFound' || e.code === 'NoSuchKey')) return null;
		throw e;
	}
}

function isTruthy(x) { return !!x; }

// ---------- Utilities ----------
// Convert DynamoDB AttributeValue maps to plain JS objects
function convertDynamoItem(item) {
	if (!item) return {};
	const out = {};
	for (const [k, v] of Object.entries(item)) {
		if (!v) continue;
		if (v.S !== undefined) out[k] = v.S;
		else if (v.N !== undefined) out[k] = v.N;
		else if (v.BOOL !== undefined) out[k] = v.BOOL;
		else if (v.SS !== undefined) out[k] = v.SS;
		else if (v.L !== undefined) out[k] = v.L.map((e) => (e.S ?? e.N ?? e.BOOL ?? e));
		else if (v.M !== undefined) out[k] = convertDynamoItem(v.M);
	}
	return out;
}

// Heuristic: does a string look like an organization/company name?
function looksLikeOrganizationName(s) {
	if (!s) return false;
	const t = String(s).trim();
	const tl = t.toLowerCase();
	// org keywords
	const orgKw = [' pty ', ' pty. ', ' ltd', ' limited', ' inc', ' llc', ' company', ' provider', ' organisation', ' organization'];
	if (orgKw.some(k => tl.includes(k))) return true;
	// All caps long token (e.g., ENABL PTY LTD) - allow short acronyms up to 3 chars
	const caps = t.match(/[A-Z]{4,}/g);
	return !!(caps && caps.length);
}

// Tokens/phrases that should not appear in a person name
const FORBIDDEN_PERSON_TOKENS = [
	'Client', 'Participant', 'Patient', 'Consumer', 'Details', 'Intake', 'Form',
	'Provider', 'Service', 'Plan', 'NDIS', 'Support', 'Address', 'Phone', 'Email',
	'Signed', 'Signature', 'Signatory', 'Date', 'DOB', 'Authorised', 'Authorized', 'Representative', 'Witness',
	'Guardian', 'Worker', 'Staff', 'Member',
	// Additional tokens to avoid misclassifying labels as people
	'Consent', 'Verbal', 'Written', 'Informed', 'Agreement', 'Acknowledgment', 'Acknowledgement', 'Declaration', 'Section', 'Page', 'Terms', 'Conditions'
];

function containsForbiddenPersonToken(name) {
	const parts = String(name || '').split(/\s+/);
	return parts.some(p => FORBIDDEN_PERSON_TOKENS.includes(p.replace(/\.?$/,'')));
}

// Extract a likely person name from a labeled line, e.g., "Participant: John Doe"
function extractNameFromLabeledValue(line) {
	if (!line) return null;
	// Only consider labeled values that include a ':' or '-'
	if (!/[\:\-]/.test(line)) return null;
	// Grab the value after ':' or '-'
	const m = line.match(/[:\-]\s*(.+)$/);
	const value = (m ? m[1] : '').trim();
	if (!value) return null;
	// Prefer Title Case person-like names (at least two words starting with capitals)
	const nameMatch = value.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})\b/);
	if (nameMatch && nameMatch[1]) {
		const nm = nameMatch[1].trim();
		if (!looksLikeOrganizationName(nm) && !containsForbiddenPersonToken(nm)) return nm;
	}
	// Fallback: only accept value if it looks like a person name (prevents labels like "Verbal Consent")
	if (value && looksLikePersonName(value) && value.split(/\s+/).length <= 5) {
		return value;
	}
	return null;
}

// Heuristic: looks like a person name (2-4 Title Case words), not an organization
function looksLikePersonName(s) {
	if (!s) return false;
	const t = String(s).trim();
	if (looksLikeOrganizationName(t)) return false;
	if (/^(Client|Patient|Participant|Consumer)\s+Details$/i.test(t)) return false;
	if (/Participant\s+Intake\s+Form/i.test(t)) return false;
	const m = t.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})\b/);
	if (!(m && m[1])) return false;
	return !containsForbiddenPersonToken(m[1]);
}

// Extract a participant-like name from filename tokens (e.g., ..._prs_ron-lapira_...)
function extractParticipantFromFilename(fileName = '') {
	const f = String(fileName).toLowerCase();
	const parts = f.split(/[\/]/).pop()?.split(/[_\s]+/) || [];
	// Prefer token after 'prs' or 'prssrs'
	const idx = parts.findIndex(p => /^prs/.test(p));
	let candidate = null;
	if (idx >= 0 && parts[idx + 1]) candidate = parts[idx + 1];
	// Else, find first hyphenated token with letters only
	if (!candidate) candidate = parts.find(p => /[a-z]+-[a-z]+/.test(p) && !/\d/.test(p));
	if (!candidate) return null;
	const name = candidate.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
	if (looksLikePersonName(name)) return name;
	return null;
}

// Try to extract a person name from free-form answer text
function extractPersonFromAnswerText(text) {
	if (!text) return null;
	const t = String(text);
	// Prefer after explicit Answer:
	const ans = t.match(/Answer\s*:\s*([^\n\r]+)/i);
	const candidate = (ans ? ans[1] : t).trim();
	const m = candidate.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})\b/);
	const name = m && m[1] ? m[1].trim() : null;
	if (name && looksLikePersonName(name)) return name;
	return null;
}

// Attempt to find the recipient/person (participant/client/patient) in document text
function findRecipientCandidate(text) {
	if (!text) return null;
	const lines = String(text).split(/\r?\n/).map(l => l.trim()).filter(Boolean);
	// Stricter: require explicit label with ':' or '-' and a value; avoid matching generic headings like "Client Details"
	const labelRegexes = [
		/(participant\s*name|name\s*of\s*participant)\s*[:\-]\s*(.+)/i,
		/(client\s*name|name\s*of\s*client)\s*[:\-]\s*(.+)/i,
		/(patient\s*name|name\s*of\s*patient)\s*[:\-]\s*(.+)/i,
		/(consumer\s*name|name\s*of\s*consumer)\s*[:\-]\s*(.+)/i,
	];
	// 1) Look for explicit labels
	for (const line of lines.slice(0, 400)) {
		for (const rx of labelRegexes) {
			const m = line.match(rx);
			if (m) {
				const candidate = extractNameFromLabeledValue(line);
				if (candidate) return { name: candidate, evidence: line };
			}
		}
	}
	// 2) Look for signing blocks: "Signed by Participant: <Name>"
	for (const line of lines.slice().reverse()) {
		const m = line.match(/signed\s+by\s+(participant|client|patient|consumer)\s*[:\-]?\s*(.+)/i);
		if (m) {
			const candidate = extractNameFromLabeledValue(line);
			if (candidate) return { name: candidate, evidence: line };
		}
	}
	// 3) Scan for a standalone Title Case name near words like Participant/Client within a small window
	for (let i = 0; i < Math.min(lines.length, 300); i++) {
		const l = lines[i];
		if (/(participant|client|patient|consumer)/i.test(l)) {
			for (let j = i; j < Math.min(i + 5, lines.length); j++) {
				const val = lines[j];
				const nameMatch = val.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})\b/);
				if (
					nameMatch && nameMatch[1] &&
					looksLikePersonName(nameMatch[1]) &&
					!/^(Client|Patient|Participant|Consumer)\s+Details$/i.test(val) &&
					!/Participant\s+Intake\s+Form/i.test(val)
				) {
					return { name: nameMatch[1].trim(), evidence: val };
				}
			}
		}
	}
	return null;
}

// Phrases that should not be treated as organizations
const FORBIDDEN_ORG_PHRASES = [
	'verbal consent', 'consent form', 'participant intake form', 'client details',
	'preventative strategies', 'behaviours', 'risk factors', 'medical history',
	'preferences and review', 'signed', 'signature', 'date', 'witness', 'guardian', 'authorised representative'
];

// Try to find the service provider / organization in the document
function findProviderCandidate(text) {
	if (!text) return null;
	const lines = String(text).split(/\r?\n/).map(l => l.trim()).filter(Boolean);

	const bad = (s) => {
		const tl = s.toLowerCase();
		return FORBIDDEN_ORG_PHRASES.some(p => tl.includes(p));
	};

	// 1) Look for explicit labels
	const labelRxs = [
		/(service\s*provider|provider|organisation|organization|company|agency)\s*[:\-]\s*(.+)/i,
		/(provider\s*name)\s*[:\-]\s*(.+)/i,
	];
	for (const line of lines.slice(0, 500)) {
		if (bad(line)) continue;
		for (const rx of labelRxs) {
			const m = line.match(rx);
			if (m && m[2]) {
				const value = m[2].trim();
				if (value && looksLikeOrganizationName(value)) {
					return { org: value, evidence: line };
				}
			}
		}
	}

	// 2) Scan header/footer zones for all-caps org-like tokens (e.g., ENABL PTY LTD)
	const zones = [
		...lines.slice(0, 60),
		...lines.slice(Math.max(0, lines.length - 40))
	];
	for (const l of zones) {
		if (bad(l)) continue;
		const m = l.match(/([A-Z][A-Z &.,'\-]{3,}\b(?:PTY\.?\s*LTD\.?|LTD\.?|INC\.?|LLC)\b)/);
		if (m && m[1]) {
			const org = m[1].replace(/\s+/g, ' ').trim();
			return { org, evidence: l };
		}
		// broader uppercase chunk, still avoid forbidden phrases
		const upper = l.match(/([A-Z][A-Z &.,'\-]{4,})/);
		if (upper && upper[1]) {
			const org = upper[1].replace(/\s+/g, ' ').trim();
			if (looksLikeOrganizationName(org)) {
				return { org, evidence: l };
			}
		}
	}

	// 3) Fallback: search anywhere for PTY LTD/LLC/LTD markers first
	const m2 = String(text).match(/([A-Z][A-Z &.,'\-]{2,}\b(?:PTY\.?\s*LTD\.?|LTD\.?|INC\.?|LLC)\b)/);
	if (m2 && m2[1] && !bad(m2[1])) {
		return { org: m2[1].replace(/\s+/g, ' ').trim(), evidence: m2[1] };
	}

	return null;
}

// Parse composite QA asks from the user message
function parseCompositeQA(message = '') {
	const m = (message || '').toLowerCase();
	const askRecipient = /\b(who\s+is\s+(the\s+)?(participant|client|patient|consumer)(\s+of\s+(this\s+)?document)?|who\s+is\s+(this\s+)?document\s+for|who\s+is\s+this\s+for|participant\s*\?|recipient\s*\?)\b/.test(m);
	const askProvider = /\b(service\s*provider|who\s+is\s+the\s+provider|provider\s*\?)\b/.test(m);
	return { askRecipient, askProvider };
}

function questionImpliesRecipient(message = '') {
	const m = (message || '').toLowerCase();
	return /\b(participant|recipient|client|patient|consumer)\b/.test(m) && /\bwho\b/.test(m);
}

// Detect if a message is a question (simple heuristic)
function isQuestionMessage(msg) {
	const m = (msg || '').toLowerCase();
	if (!m) return false;
	return /\?|\b(who|what|when|where|why|how|which|does|do|did|is|are|can|could|should|would)\b/.test(m);
}

async function resolveS3Key(bucket, s3Key, fileName, userId) {
	// 1) Try provided key
	if (s3Key) {
		const head = await headObjectSafe(bucket, s3Key);
		if (head) return { key: s3Key, meta: head.Metadata || {} };
	}

	const candidates = [];
	const baseName = (fileName || '').trim();
	if (baseName) {
		candidates.push(`documents/${baseName}`);
		candidates.push(baseName);
	}

	// 2) Try simple candidate keys
	for (const k of candidates) {
		const head = await headObjectSafe(bucket, k);
		if (head) return { key: k, meta: head.Metadata || {} };
	}

	// 3) Search under documents/ by metadata original-name + owner-id
	try {
		const list = await s3.listObjectsV2({ Bucket: bucket, Prefix: 'documents/' }).promise();
		const contents = list.Contents || [];
		for (const obj of contents) {
			const key = obj.Key;
			try {
				const head = await s3.headObject({ Bucket: bucket, Key: key }).promise();
				const meta = head.Metadata || {};
				const original = meta['original-name'] || meta['original_name'];
				const owner = meta['owner-id'] || meta['owner_id'];
				if (original && baseName && original === baseName && (!userId || !owner || owner === userId)) {
					return { key, meta };
				}
			} catch (_) {
				// ignore and continue
			}
		}
	} catch (e) {
		console.warn('listObjects/metadata search failed:', e?.message);
	}
	return { key: s3Key || (baseName ? `documents/${baseName}` : null), meta: {} };
}

function ensureArray(val) {
	if (!val) return [];
	return Array.isArray(val) ? val : [val];
}

function parseDate(value) {
	if (!value) return null;
	const d = new Date(value);
	return isNaN(d.getTime()) ? null : d;
}

function bytesToHuman(bytes) {
	const n = Number(bytes || 0);
	if (!n) return '';
	const units = ['B', 'KB', 'MB', 'GB'];
	let i = 0, v = n;
	while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
	return `${v.toFixed(i === 0 ? 0 : 2)} ${units[i]}`;
}

// ---------- Session memory (S3 JSON) ----------
async function loadSession(sessionId) {
	if (!sessionId) return {};
	const key = `sessions/${sessionId}.json`;
	try {
		const obj = await s3.getObject({ Bucket: UPLOADS_BUCKET, Key: key }).promise();
		const txt = (obj.Body || Buffer.from('')).toString('utf-8');
		return JSON.parse(txt || '{}');
	} catch (_) {
		return {};
	}
}

async function saveSession(sessionId, state) {
	if (!sessionId) return;
	const key = `sessions/${sessionId}.json`;
	try {
		await s3.putObject({ Bucket: UPLOADS_BUCKET, Key: key, Body: Buffer.from(JSON.stringify(state || {}, null, 2), 'utf-8'), ContentType: 'application/json' }).promise();
	} catch (_) { /* best-effort */ }
}

// Try to infer region and document type from content/filename
function detectRegionAndDocType(text = '', fileName = '') {
	const t = (text || '').toLowerCase();
	const f = (fileName || '').toLowerCase();
	let region = null;
	if (/\bundis\b|\bndis\b|\baustralia\b|\bnsw\b|\bvic\b|\bqld\b/.test(t) || /\bundis\b|\baustralia\b/.test(f)) region = 'AU';
	else if (/\bhipaa\b|\bus\b|\busa\b/.test(t) || /\busa\b|\bus\b/.test(f)) region = 'US';
	else if (/\beu\b|\bgdpr\b/.test(t) || /\beu\b/.test(f)) region = 'EU';

	let docType = null;
	if (/participant\s*intake\s*form/i.test(text) || /intake_form|participant_-_intake_form/.test(f)) docType = 'participant-intake-form';
	else if (/consent\s*form/i.test(text) || /consent_form|participant_-_consent_form/.test(f)) docType = 'consent-form';
	return { region, docType };
}

// Extract key entities from document text
function extractEntitiesFromContent(text = '', fileName = '') {
	const t = String(text);
	const recipient = findRecipientCandidate(t);
	const lines = t.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
	const grab = (rx) => {
		const L = lines.find(l => rx.test(l));
		if (!L) return null;
		const m = L.match(rx);
		return (m && (m[1] || m[0])) ? (m[1] || m[0]).toString().trim() : null;
	};
	const email = (t.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i) || [])[0] || null;
	const phones = Array.from(new Set((t.match(/\b(?:\+?61|0)[\s-]?[2-578]\d{1,3}[\s-]?\d{3}[\s-]?\d{3,4}\b/gi) || []).map(x => x.trim())));
	const dob = grab(/date\s*of\s*birth\s*[:\-]\s*([^\n]+)/i) || (t.match(/\b(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4})\b.*?(date\s*of\s*birth)/i) ? RegExp.$1 : null);
	const address = grab(/address\s*[:\-]\s*([^\n]+)/i) || (t.match(/\b\d+\s+[^,\n]+,\s*[^\n]+\b/) || [])[0] || null;
	const idFromName = (fileName.match(/_(\d{6,})_/)) ? fileName.match(/_(\d{6,})_/)[1] : null;
	return {
		participant: recipient?.name || null,
		participantEvidence: recipient?.evidence || null,
		email,
		phones,
		dob,
		address,
		referenceId: idFromName,
	};
}

async function loadRagSnippets(region, docType) {
	if (!KNOWLEDGE_BASE_BUCKET) return '';
	const candidates = [];
	if (region === 'AU') {
		// NDIS-oriented cheatsheets
		candidates.push('regional-healthcare/australia/ndis/overview.md');
		if (docType === 'participant-intake-form') candidates.push('regional-healthcare/australia/ndis/intake-form-guidelines.md');
		if (docType === 'consent-form') candidates.push('regional-healthcare/australia/ndis/consent-guidelines.md');
	}
	// Generic medical/consent guidelines
	candidates.push('medical-guidelines/privacy-consent.md');

	const parts = [];
	for (const key of candidates) {
		try {
			const obj = await s3.getObject({ Bucket: KNOWLEDGE_BASE_BUCKET, Key: key }).promise();
			const txt = (obj.Body || Buffer.from('')).toString('utf-8');
			if (txt && txt.trim()) parts.push(`-- ${key} --\n${txt.trim().slice(0, 4000)}`);
		} catch (_) {
			// ignore missing keys
		}
		if (parts.join('\n').length > 12000) break; // cap
	}
	return parts.join('\n\n');
}

// ---------- Embeddings + Vector Search ----------
async function embedText(text) {
	// Use Bedrock Titan Embeddings if available
	try {
		if (!bedrockClient) return null;
		const body = JSON.stringify({ inputText: String(text || '').slice(0, 8000) });
		const params = { modelId: 'amazon.titan-embed-text-v1', contentType: 'application/json', accept: 'application/json', body };
		const res = await bedrockClient.invokeModel(params).promise();
		const raw = res.body || res.Body || res.payload || res.Payload;
		const textOut = typeof raw === 'string' ? raw : Buffer.isBuffer(raw) ? raw.toString('utf-8') : (raw?.toString?.() || '');
		const json = JSON.parse(textOut || '{}');
		const vec = json.embedding || json.output?.embedding;
		if (Array.isArray(vec) && vec.length) return vec.slice(0, VECTOR_DIM);
		return null;
	} catch (_) {
		return null;
	}
}

async function signedFetchOpenSearch(path, method, body) {
	if (!VECTOR_ENDPOINT) throw new Error('VECTOR_ENDPOINT not configured');
	// Use AWS SDK v2 SigV4 signer via AWS.HttpRequest + AWS.Signers.V4
	const url = new URL(VECTOR_ENDPOINT);
	const request = new AWS.HttpRequest(url.toString(), REGION);
	request.method = method;
	request.path = path;
	request.body = body ? JSON.stringify(body) : undefined;
	request.headers['host'] = url.host;
	request.headers['content-type'] = 'application/json';

	const signer = new AWS.Signers.V4(request, 'aoss'); // OpenSearch Serverless service identifier
	signer.addAuthorization(AWS.config.credentials, new Date());

	// Use node https directly
	const https = require('https');
	return new Promise((resolve, reject) => {
		const req = https.request(url, { method: request.method, headers: request.headers, path: request.path }, (res) => {
			let data = '';
			res.on('data', (chunk) => (data += chunk));
			res.on('end', () => {
				try {
					resolve({ statusCode: res.statusCode, body: data ? JSON.parse(data) : {} });
				} catch (_) {
					resolve({ statusCode: res.statusCode, body: {} });
				}
			});
		});
		req.on('error', reject);
		if (request.body) req.write(request.body);
		req.end();
	});
}

async function queryOpenSearchKnn({ vector, docId, topK = 6 }) {
	if (!VECTOR_ENDPOINT || !vector || !Array.isArray(vector)) return [];
	const body = {
		size: topK,
		query: {
			bool: {
				must: [
					{ knn: { embedding: { vector, k: topK } } }
				],
				filter: docId ? [{ term: { documentId: docId } }] : [],
			},
		},
		_source: ['text', 'chunkId', 'documentId', 'fileName']
	};
	const res = await signedFetchOpenSearch(`/${encodeURIComponent(VECTOR_INDEX)}/_search`, 'POST', body);
	const hits = res?.body?.hits?.hits || [];
	return hits.map(h => ({ text: h._source?.text, score: h._score, chunkId: h._source?.chunkId, documentId: h._source?.documentId, fileName: h._source?.fileName })).filter(x => x.text);
}

function uniqueByFileName(items) {
	const seen = new Set();
	const out = [];
	for (const d of items) {
		const name = d.fileName || (d.s3Key ? String(d.s3Key).split('/').pop() : undefined) || d.title || '';
		const key = name.toLowerCase();
		if (!key || seen.has(key)) continue;
		seen.add(key);
		out.push({ ...d, fileName: name });
	}
	return out;
}

async function tryHeadForDoc(d, userId) {
	// Attempt to resolve S3 key using available info, then headObject to read metadata
	try {
		const preferredBucket = d.bucket || UPLOADS_BUCKET;
		const fileName = d.fileName || (d.s3Key ? String(d.s3Key).split('/').pop() : '') || '';
		// First bucket
		if (preferredBucket) {
			const r1 = await resolveS3Key(preferredBucket, d.s3Key, fileName, userId);
			if (r1?.key) {
				const head = await headObjectSafe(preferredBucket, r1.key);
				if (head) return { bucket: preferredBucket, key: r1.key, head };
			}
		}
		// Fallback to documents bucket
		if (DOCUMENTS_BUCKET && DOCUMENTS_BUCKET !== preferredBucket) {
			const r2 = await resolveS3Key(DOCUMENTS_BUCKET, d.s3Key, fileName, userId);
			if (r2?.key) {
				const head2 = await headObjectSafe(DOCUMENTS_BUCKET, r2.key);
				if (head2) return { bucket: DOCUMENTS_BUCKET, key: r2.key, head: head2 };
			}
		}
	} catch (_) { /* ignore */ }
	return null;
}

// Simple string similarity via Jaccard on word sets
function jaccardSimilarity(a, b) {
	const sa = new Set((a || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
	const sb = new Set((b || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
	if (!sa.size && !sb.size) return 0;
	let inter = 0;
	for (const t of sa) if (sb.has(t)) inter++;
	const union = sa.size + sb.size - inter;
	return union ? inter / union : 0;
}

// ---------- Core: Bedrock analysis ----------
function localSummarize(text, fileName, fileType, meta = {}, rag = '') {
	const t = (text || '').toString();
	if (!t || /^\[Binary/.test(t)) {
		return `I couldn't extract readable text from this ${fileType || 'file'}. If it's a PDF, ensure text extraction ran (KB text available).`;
	}
	const { region, docType } = meta;
	const entities = extractEntitiesFromContent(t, fileName || '');
	const title = docType === 'participant-intake-form' ? 'Participant Intake Form' : (docType === 'consent-form' ? 'Consent Form' : 'Document');

	// Basic sentence segmentation
	const sentences = t
	    	.replace(/\s+/g, ' ')
	    	.split(/(?<=[.!?])\s+(?=[A-Z0-9])/)
	    	.filter((s) => s && s.length > 2)
	    	.slice(0, 12);

	// Simple scoring by term frequency (stopwords removed)
	const stop = new Set('a,an,the,and,or,of,for,to,in,on,at,by,with,from,is,are,was,were,be,as,it,that,this,these,those,has,have,had,not,can,will,may,shall,should,must,do,does,did,you,your,our,their,there,here,about,into,over,under,between,within,per'.split(','));
	const wordCounts = new Map();
	for (const w of t.toLowerCase().match(/[a-z0-9][a-z0-9\-]+/g) || []) {
		if (stop.has(w)) continue;
		wordCounts.set(w, (wordCounts.get(w) || 0) + 1);
	}

	function scoreSentence(s) {
		let score = 0;
		for (const w of s.toLowerCase().match(/[a-z0-9][a-z0-9\-]+/g) || []) {
			if (stop.has(w)) continue;
			score += wordCounts.get(w) || 0;
		}
		return score;
	}

	const topSentences = sentences
		.map((s) => ({ s, score: scoreSentence(s) }))
		.sort((a, b) => b.score - a.score)
		.slice(0, 5)
		.map((x) => x.s.trim());

	const keywords = [...wordCounts.entries()]
		.sort((a, b) => b[1] - a[1])
		.slice(0, 10)
		.map(([w]) => w)
		.join(', ');

	const actionLines = t
		.split(/\n+/)
		.filter((line) => /\b(must|should|required|please|due|deadline|appointment|follow[- ]?up|contact)\b/i.test(line))
		.slice(0, 5)
		.map((l) => l.trim());

	const header = [
		`Title: ${title}`,
		entities.participant ? `Who it's for: ${entities.participant}` : null,
		entities.referenceId ? `Reference: ${entities.referenceId}` : null,
		region ? `Region: ${region}` : null,
	].filter(Boolean).join('\n');

	const sections = [
		'\nSummary:',
		(topSentences.join(' ') || topSentences.slice(0, 3).join(' ')) || 'n/a',
		'\nKey Sections (inferred):',
		'- Client/Participant Details\n- Risk Factors and Medical History\n- Behaviours and Strategies\n- Preferences and Review',
		'\nHighlights:',
		'- ' + (topSentences.slice(0, 5).map((s) => s.replace(/\s+/g, ' ').slice(0, 180)).join('\n- ') || 'n/a'),
		'\nAction Items:',
		(actionLines.length ? ('- ' + actionLines.join('\n- ')) : 'n/a'),
		'\nContacts:',
		[entities.email ? `Email: ${entities.email}` : null, entities.phones?.length ? `Phone: ${entities.phones.slice(0,2).join(', ')}` : null, entities.address ? `Address: ${entities.address}` : null, entities.dob ? `DOB: ${entities.dob}` : null].filter(Boolean).join('\n') || 'n/a',
		'\nKeywords:',
		keywords || 'n/a',
	].join('\n');

	const ragNote = rag ? '\n\nContext (guidelines excerpt):\n' + rag.slice(0, 800) : '';
	return [`Document: ${fileName}`, header, sections, ragNote].filter(Boolean).join('\n');
}
async function analyzeDocumentWithNova(documentContent, fileName, fileType, meta = {}, rag = '') {
	const { region, docType, entities } = meta;
	const metaHeader = [
		'ENABL_META:',
		region ? `region: ${region}` : null,
		docType ? `docType: ${docType}` : null,
		entities?.participant ? `participant: ${entities.participant}` : null,
		entities?.referenceId ? `referenceId: ${entities.referenceId}` : null,
	].filter(Boolean).join('\n');

	const ragBlock = rag ? `\n\nRAG_SNIPPETS (regional guidance):\n${rag}\n` : '';

	const prompt = `You are an expert healthcare document analyst. Using only the provided content, produce a concise, factual summary for a ${fileType} document named "${fileName}".
Return well-structured sections tailored to the document type and region when given.

${metaHeader}

Required sections:
- Title
- Who it's for (participant/person) — if explicit; do not guess. If unclear, say "Unknown".
- Purpose and context (e.g., NDIS intake/consent, include region-specific framing if region=AU and docType matches)
- Key sections present (bulleted)
- Notable risks/medical history/behaviours (if present)
- Action items (short bullet list)
- Keywords (comma-separated)
Include 1-2 short evidence quotes only when they are clearly supportive; otherwise skip quotes. Be crisp.

Document Content:\n${documentContent}${ragBlock}`;

	if (!bedrockClient) {
	return localSummarize(documentContent, fileName, fileType, meta, rag);
	}
	const body = JSON.stringify({
		messages: [{ role: 'user', content: prompt }],
		max_tokens: 1800,
		temperature: 0.3,
	});
	const params = { modelId: 'amazon.nova-pro-v1:0', contentType: 'application/json', accept: 'application/json', body };

	try {
		const res = await bedrockClient.invokeModel(params).promise();
		const raw = res.body || res.Body || res.payload || res.Payload;
		const text = typeof raw === 'string' ? raw : Buffer.isBuffer(raw) ? raw.toString('utf-8') : (raw?.toString?.() || '');
		const responseBody = JSON.parse(text || '{}');
		return responseBody.output?.message?.content || responseBody.content || 'Analysis complete.';
	} catch (err) {
		console.error('Bedrock analysis error:', err);
	return localSummarize(documentContent, fileName, fileType, meta, rag);
	}
}

// ---------- Document QA (Bedrock + local fallback) ----------
async function answerQuestionWithNova(documentContent, fileName, fileType, question) {
	const prompt = `You are a careful document QA assistant.
You are given the full text of a ${fileType} document named "${fileName}" and a user question.
Rules:
- Answer using only the document content.
- If the answer is not clearly stated in the document, say "I couldn't find this in the document." Do not guess.
- Provide a one-line evidence quote from the document that supports your answer when possible.

Question: ${question}

Document Content:\n${documentContent}\n`;

	if (!bedrockClient) {
		return localAnswerQuestion(documentContent, question, fileName, fileType);
	}
	const body = JSON.stringify({
		messages: [{ role: 'user', content: prompt }],
		max_tokens: 800,
		temperature: 0.2,
	});
	const params = { modelId: 'amazon.nova-pro-v1:0', contentType: 'application/json', accept: 'application/json', body };
	try {
		const res = await bedrockClient.invokeModel(params).promise();
		const raw = res.body || res.Body || res.payload || res.Payload;
		const text = typeof raw === 'string' ? raw : Buffer.isBuffer(raw) ? raw.toString('utf-8') : (raw?.toString?.() || '');
		const responseBody = JSON.parse(text || '{}');
		const out = responseBody.output?.message?.content || responseBody.content || '';
		return out || "I couldn't find this in the document.";
	} catch (err) {
		console.error('Bedrock QA error:', err);
		return localAnswerQuestion(documentContent, question, fileName, fileType);
	}
}

function localAnswerQuestion(text, question, fileName, fileType) {
	const t = (text || '').toString();
	if (!t || /^\[Binary/.test(t)) {
		return `I couldn't extract readable text from this ${fileType || 'file'}, so I can't answer the question.`;
	}
	const q = (question || '').toLowerCase();
	// Very basic heuristics for "who is the company" style
	// Look for likely organization lines
	const lines = t.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
	const orgPatterns = [
		/(pty\.?\s*ltd\.?)/i,
		/(inc\.|incorporated)/i,
		/(llc|l\.?l\.?c\.?)/i,
		/(ltd\.|limited)/i,
		/company|organisation|organization|provider/i,
	];
	let candidate = '';
	for (const line of lines.slice(0, 200)) { // prefer header area
		if (orgPatterns.some(p => p.test(line))) {
			// Try to capture a likely name token near the pattern
			const m = line.match(/([A-Z][A-Z &.,'-]{2,}\b\s*(?:PTY\.?\s*LTD\.?|LTD\.?|INC\.|LLC)\b)/i);
			if (m && m[1]) { candidate = m[1].replace(/\s+/g, ' ').trim(); break; }
			// fallback: take prominent uppercase chunk
			const upper = line.match(/([A-Z][A-Z &.,'-]{3,})/);
			if (upper && upper[1]) { candidate = upper[1].replace(/\s+/g, ' ').trim(); break; }
		}
	}
	if (!candidate) {
		// search entire doc for ENABL PTY LTD-like
		const m2 = t.match(/([A-Z][A-Z &.,'-]{2,}\b\s*(?:PTY\.?\s*LTD\.?|LTD\.?|INC\.|LLC)\b)/);
		if (m2 && m2[1]) candidate = m2[1].replace(/\s+/g, ' ').trim();
	}
	if (candidate) {
		return `Answer: ${candidate}\nEvidence: "${candidate}"`;
	}
	// Generic fallback: extract first strong noun-ish phrase from header
	if (lines[0]) {
		return `I couldn't find this in the document. Evidence: "${lines[0].slice(0, 180)}"`;
	}
	return `I couldn't find this in the document.`;
}

// ---------- PDF text extraction via Textract (async job) ----------
async function extractPdfTextWithTextract(bucket, key, { maxWaitMs = 90000, pollMs = 2000 } = {}) {
 	if (!textract) throw new Error('Textract client unavailable');
 	const start = await textract.startDocumentTextDetection({
 		DocumentLocation: { S3Object: { Bucket: bucket, Name: key } },
 	}).promise();
 	const jobId = start.JobId;
 	if (!jobId) throw new Error('Failed to start Textract job');

 	const deadline = Date.now() + maxWaitMs;
 	let status = 'IN_PROGRESS';
 	while (Date.now() < deadline) {
 		await new Promise((r) => setTimeout(r, pollMs));
 		const resp = await textract.getDocumentTextDetection({ JobId: jobId }).promise();
 		status = resp.JobStatus;
 		if (status === 'SUCCEEDED') {
 			let nextToken = resp.NextToken;
 			const lines = [];
 			const consume = (blocks) => {
 				for (const b of blocks || []) if (b.BlockType === 'LINE' && b.Text) lines.push(b.Text);
 			};
 			consume(resp.Blocks);
 			while (nextToken) {
				const page = await textract.getDocumentTextDetection({ JobId: jobId, NextToken: nextToken }).promise();
 				consume(page.Blocks);
 				nextToken = page.NextToken;
 			}
 			return lines.join('\n');
 		}
 		if (status === 'FAILED' || status === 'PARTIAL_SUCCESS') break;
 	}
 	throw new Error(`Textract job did not complete in time (status=${status})`);
}

// ---------- Data access ----------
async function listDocuments({ userId, systemWide = false, limit = 200, startKey }) {
	const docs = [];
	try {
		console.log('listDocuments called', { table: DOCUMENTS_TABLE, userId, systemWide, limit, hasStartKey: !!startKey });
		if (userId && !systemWide) {
			const params = {
				TableName: DOCUMENTS_TABLE,
				KeyConditionExpression: 'userId = :uid',
				ExpressionAttributeValues: { ':uid': { S: userId } },
				ExclusiveStartKey: startKey,
				Limit: limit,
			};
			const res = await dynamodb.query(params).promise();
			(res.Items || []).forEach((it) => docs.push(convertDynamoItem(it)));
			console.log('listDocuments query result', { count: res.Count ?? (res.Items || []).length });
			return { items: docs, lastKey: res.LastEvaluatedKey };
		}

		// System-wide scan (admin or global context)
		const params = {
			TableName: DOCUMENTS_TABLE,
			ExclusiveStartKey: startKey,
			Limit: limit,
		};
		const res = await dynamodb.scan(params).promise();
		(res.Items || []).forEach((it) => docs.push(convertDynamoItem(it)));
		console.log('listDocuments scan result', { count: res.Count ?? (res.Items || []).length });
		return { items: docs, lastKey: res.LastEvaluatedKey };
	} catch (err) {
		console.error('listDocuments error:', err);
		return { items: [], lastKey: undefined };
	}
}

async function getDocumentByName(userId, documentName) {
	// Normalize helper
	const norm = (s) => (s || '').toString().trim().toLowerCase();
	const getExt = (s) => {
		const m = String(s || '').match(/\.([a-z0-9]{1,12})$/i);
		return m ? m[1].toLowerCase() : '';
	};
	const sanitize = (s) => norm(String(s || '').replace(/[^a-z0-9]+/gi, ' ').replace(/\s+/g, ' ').trim());
	const baseNameFromKey = (s) => {
		if (!s) return '';
		const parts = String(s).split('/');
		return parts[parts.length - 1] || '';
	};

	const target = norm(documentName);
	const targetExt = getExt(target);
	const targetSan = sanitize(target);

	// 1) Try direct key (treat provided name as documentId)
	try {
		const getParams = {
			TableName: DOCUMENTS_TABLE,
			Key: { userId: { S: userId }, documentId: { S: documentName } },
		};
		const res = await dynamodb.getItem(getParams).promise();
		if (res.Item) return convertDynamoItem(res.Item);
	} catch (e) {
		console.warn('GetItem by documentId failed (ok to ignore):', e?.message);
	}

	// 2) Exact match on fileName via server-side filter
	try {
		const q = {
			TableName: DOCUMENTS_TABLE,
			KeyConditionExpression: 'userId = :uid',
			FilterExpression: 'fileName = :fn',
			ExpressionAttributeValues: { ':uid': { S: userId }, ':fn': { S: documentName } },
			Limit: 200,
		};
		const qr = await dynamodb.query(q).promise();
		if (qr.Items?.length) return convertDynamoItem(qr.Items[0]);
	} catch (e) {
		console.warn('Exact filename query failed (will fallback to fuzzy):', e?.message);
	}

	// 3) Fuzzy/substring match within the user's documents (case-insensitive, basename-aware)
	try {
		const q2 = {
			TableName: DOCUMENTS_TABLE,
			KeyConditionExpression: 'userId = :uid',
			ExpressionAttributeValues: { ':uid': { S: userId } },
			Limit: 200,
		};
		const all = await dynamodb.query(q2).promise();
		const items = (all.Items || []).map(convertDynamoItem);

		let best = null;
		let bestScore = 0;
		let secondBestScore = 0;
		for (const d of items) {
			const fname = norm(d.fileName);
			const bname = norm(baseNameFromKey(d.s3Key));
			const fext = getExt(fname) || getExt(bname);
			const fsan = sanitize(fname);
			const bsan = sanitize(bname);

			// Exact (case-insensitive)
			if (fname && fname === target) return d;
			if (bname && bname === target) return d;

			// Extension must match when available
			const extMatches = !targetExt || !fext || targetExt === fext;

			// Substring contains checks on sanitized names
			let localScore = 0;
			if (extMatches) {
				if (fsan && (fsan.includes(targetSan) || targetSan.includes(fsan))) localScore = Math.max(localScore, 0.9);
				if (bsan && (bsan.includes(targetSan) || targetSan.includes(bsan))) localScore = Math.max(localScore, 0.88);
			}

			// Similarity on basenames without extension
			const stripExt = (x) => x.replace(/\.[a-z0-9]{1,12}$/i, '');
			const t0 = stripExt(targetSan);
			const f0 = stripExt(fsan);
			const b0 = stripExt(bsan);
			const sim = Math.max(jaccardSimilarity(t0, f0), jaccardSimilarity(t0, b0));
			localScore = Math.max(localScore, sim);

			if (localScore > bestScore) {
				secondBestScore = bestScore;
				best = d;
				bestScore = localScore;
			} else if (localScore > secondBestScore) {
				secondBestScore = localScore;
			}
		}
		// Only accept a fuzzy match when it's very strong and unambiguous
		if (best && (bestScore >= 0.9 || (bestScore >= 0.85 && (bestScore - secondBestScore) >= 0.15))) {
			console.log('getDocumentByName fuzzy match selected:', { target, matched: best.fileName, score: Number(bestScore.toFixed(3)), secondBest: Number(secondBestScore.toFixed(3)) });
			return best;
		}
	} catch (e) {
		console.error('Fuzzy filename match failed:', e);
	}

	// 4) Fallback: scan S3 by metadata original-name for legacy/missing DDB entries
	try {
		const bucketsToSearch = Array.from(new Set([UPLOADS_BUCKET, DOCUMENTS_BUCKET].filter(Boolean)));
		const prefixes = [
			'documents/',
			userId ? `users/${userId}/documents/` : null,
		].filter(Boolean);

		// Try direct key checks first (documents/<targetName> or <targetName>) in both buckets
		for (const b of bucketsToSearch) {
			const directCandidates = [
				`documents/${target}`,
				target,
			];
			for (const k of directCandidates) {
				try {
					const head = await s3.headObject({ Bucket: b, Key: k }).promise();
					if (head) {
						const pseudoId = String(k).split('/').pop()?.replace(/\.[^.]+$/, '') || k;
						return {
							userId,
							documentId: pseudoId,
							fileName: target,
							s3Key: k,
							bucket: b,
							fileType: head.ContentType || undefined,
							uploadedAt: undefined,
							fileSize: undefined,
						};
					}
				} catch (_) { /* continue */ }
			}
		}

		// Scan by key basename and then metadata original-name across prefixes and buckets (with pagination)
		for (const b of bucketsToSearch) {
			for (const prefix of prefixes) {
				let ContinuationToken = undefined;
				do {
					const list = await s3.listObjectsV2({ Bucket: b, Prefix: prefix, ContinuationToken }).promise();
					ContinuationToken = list.IsTruncated ? list.NextContinuationToken : undefined;
					for (const obj of list.Contents || []) {
						if (!obj.Key) continue;
						const base = String(obj.Key).split('/').pop() || '';
						const baseLc = base.toLowerCase();
						// Fast path: direct basename match (case-insensitive)
						if (baseLc === target) {
							try {
								const head = await s3.headObject({ Bucket: b, Key: obj.Key }).promise();
								const pseudoId = base.replace(/\.[^.]+$/, '') || base;
								return {
									userId,
									documentId: pseudoId,
									fileName: base,
									s3Key: obj.Key,
									bucket: b,
									fileType: head.ContentType || undefined,
									uploadedAt: obj.LastModified?.toISOString?.() || undefined,
									fileSize: obj.Size || undefined,
								};
							} catch (_) { /* continue */ }
						}

						// Secondary: metadata-driven fuzzy match
						try {
						const head = await s3.headObject({ Bucket: b, Key: obj.Key }).promise();
						const meta = head.Metadata || {};
						const original = norm(meta['original-name'] || meta['original_name'] || '');
						const owner = meta['owner-id'] || meta['owner_id'];
						if (owner && userId && owner !== userId) continue;

						if (original) {
							const origExt = getExt(original);
							const extMatches2 = !targetExt || !origExt || targetExt === origExt;
							const osan = sanitize(original);
							const substrMatch = extMatches2 && (osan === targetSan || osan.includes(targetSan) || targetSan.includes(osan));
							const sim = jaccardSimilarity(targetSan.replace(/\.[a-z0-9]{1,12}$/i, ''), osan.replace(/\.[a-z0-9]{1,12}$/i, ''));
							if (extMatches2 && (substrMatch || sim >= 0.9)) {
								const key = obj.Key;
								const pseudoId = String(key).split('/').pop()?.replace(/\.[^.]+$/, '') || key;
								console.log('getDocumentByName S3-metadata fallback selected:', { target, key, bucket: b, original, sim: Number(sim.toFixed(3)) });
								return {
									userId,
									documentId: pseudoId,
									fileName: original,
									s3Key: key,
									bucket: b,
									fileType: head.ContentType || undefined,
									uploadedAt: obj.LastModified?.toISOString?.() || undefined,
									fileSize: obj.Size || undefined,
								};
							}
						}
						} catch (_) { /* continue */ }
					}
				} while (ContinuationToken);
			}
		}
	} catch (e) {
		console.warn('S3 metadata/lookup fallback failed:', e?.message);
	}

	return null;
}

// ---------- Relationships and insights ----------
function buildRelationships(documents) {
	const items = documents.map((d, i) => ({
		idx: i,
		id: d.documentId || `${d.userId || 'u'}:${d.fileName || 'file'}:${i}`,
		userId: d.userId,
		name: d.fileName || d.title || `Doc ${i + 1}`,
		type: (d.fileType || '').toLowerCase(),
		provider: (d.provider || d.facility || '').toLowerCase(),
		tags: ensureArray(d.tags).map((t) => String(t).toLowerCase()),
		date: parseDate(d.uploadedAt || d.date || d.createdAt),
		size: Number(d.fileSize || 0),
		desc: d.description || d.summary || '',
	}));

	// Pairwise relationship scoring
	const edges = [];
	for (let i = 0; i < items.length; i++) {
		for (let j = i + 1; j < items.length; j++) {
			const a = items[i];
			const b = items[j];

			// Tags overlap (Jaccard)
			const tagsA = new Set(a.tags || []);
			const tagsB = new Set(b.tags || []);
			let tagInter = 0;
			for (const t of tagsA) if (tagsB.has(t)) tagInter++;
			const tagUnion = tagsA.size + tagsB.size - tagInter || 1;
			const tagScore = tagInter / tagUnion;

			// Type / provider
			const typeScore = a.type && b.type && a.type === b.type ? 0.2 : 0;
			const providerScore = a.provider && b.provider && a.provider === b.provider ? 0.15 : 0;

			// Title/desc similarity
			const textScore = Math.max(
				jaccardSimilarity(a.name, b.name),
				jaccardSimilarity(a.desc, b.desc)
			) * 0.4;

			// Temporal proximity (within 14 days)
			let timeScore = 0;
			if (a.date && b.date) {
				const days = Math.abs(a.date - b.date) / (1000 * 60 * 60 * 24);
				if (days <= 14) timeScore = 0.15;
				else if (days <= 60) timeScore = 0.05;
			}

			const score = tagScore * 0.5 + typeScore + providerScore + textScore + timeScore;
			if (score >= 0.25) {
				edges.push({ a: a.id, b: b.id, score: Number(score.toFixed(3)) });
			}
		}
	}

	// Groupings
	const byType = {};
	const byUser = {};
	for (const it of items) {
		byType[it.type] = byType[it.type] || [];
		byType[it.type].push(it.id);
		if (it.userId) {
			byUser[it.userId] = byUser[it.userId] || [];
			byUser[it.userId].push(it.id);
		}
	}

	// Top connections
	const topEdges = [...edges]
		.sort((x, y) => y.score - x.score)
		.slice(0, 20);

	return { nodes: items, edges: topEdges, byType, byUser };
}

function generateCrossDocInsights(documents, rel) {
	// Basic insights without model calls
	const total = documents.length;
	const types = documents.reduce((acc, d) => {
		const t = (d.fileType || 'unknown').toLowerCase();
		acc[t] = (acc[t] || 0) + 1;
		return acc;
	}, {});

	const typeSummary = Object.entries(types)
		.sort((a, b) => b[1] - a[1])
		.slice(0, 5)
		.map(([t, n]) => `${t}: ${n}`)
		.join(', ');

	const strongest = rel.edges.slice(0, 5).map((e) => `(${e.a}) ⟷ (${e.b}) [${e.score}]`);

	return [
		`Total documents: ${total}`,
		`Types distribution: ${typeSummary || 'n/a'}`,
		`Top relationships: ${strongest.join('; ') || 'n/a'}`,
	].join('\n');
}

async function generateDocumentContextSummary(documents, isSystemWide = false) {
	if (!documents?.length) {
		return isSystemWide
			? 'No documents found in the system.'
			: 'You have not uploaded any documents yet.';
	}

	const totalSize = documents.reduce((s, d) => s + (Number(d.fileSize) || 0), 0);
	const byType = documents.reduce((acc, d) => {
		const t = (d.fileType || 'unknown').toLowerCase();
		acc[t] = (acc[t] || 0) + 1;
		return acc;
	}, {});

	const parts = [];
	parts.push(`Total Documents: ${documents.length}`);
	parts.push(`Total Storage: ${(totalSize / (1024 * 1024)).toFixed(2)} MB`);
	parts.push(
		'Types: ' + Object.entries(byType).map(([t, n]) => `${t}(${n})`).join(', ')
	);
	const recent = [...documents]
		.sort((a, b) => new Date(b.uploadedAt || 0) - new Date(a.uploadedAt || 0))
		.slice(0, 5)
		.map((d) => {
			const name = d.fileName || (d.s3Key ? String(d.s3Key).split('/').pop() : undefined) || d.title || 'Unknown';
			return `${name} (${d.fileType || 'unknown'})`;
		});
	parts.push('Recent: ' + (recent.join('; ') || 'n/a'));
	return parts.join('\n');
}

// ---------- Intent parsing ----------
function parseIntent(message = '') {
	const m = (message || '').toLowerCase();
	// Flexible list intent: allow either order of verbs and nouns
	const listVerbs = /\b(list|show|name)\b/;
	const docNouns = /\b(docs?|documents?|files?|uploads?)\b/;
	const wantsList = (listVerbs.test(m) && docNouns.test(m))
		|| /\blist (them|all)\b/.test(m)
		|| /\bshow (me\s+)?(everything|all)\b/.test(m)
		|| /\b(my|mine)\s+(docs?|documents?|files?|uploads?)\b/.test(m);

	// Count intent: "how many"/"count"/"number of" with doc nouns
	const wantsCount = (/\bhow\s+many\b/.test(m) || /\bcount\b/.test(m) || /\bnumber\s+of\b/.test(m)) && docNouns.test(m);

	// Summary intent: summarise/summarize/tl;dr/overview
	const wantsSummary = /\b(summarise|summarize|summary|tl;dr|tldr|overview)\b/.test(m);

	// System scope: clear system/all-users/global cues
	const wantsSystem = /\b(system|all\s+users|global|org[-\s]?wide|organization[-\s]?wide|organisation[-\s]?wide)\b/.test(m);
	const userMatch = m.match(/\buser[:\s]+([a-z0-9_-]{4,})/i);
	const targetUserId = userMatch?.[1];
	const wantsRelations = /\b(relationships?|related|connections?|link(s|ed)?)\b/.test(m);
	const wantsContext = /\b(context|knowledge|summary|overview|insights?)\b/.test(m);
	return { wantsList, wantsSystem, targetUserId, wantsRelations, wantsContext, wantsCount, wantsSummary };
}

// ---------- Lambda handler ----------
module.exports.handler = async function handler(event) {
	console.log('Document Agent event:', JSON.stringify(event));
	try {
		const body = typeof event.body === 'string' ? JSON.parse(event.body) : (event.body || event);
	const message = body?.message || '';
		const userId = body?.userId || event?.requestContext?.authorizer?.claims?.sub || body?.authUserId;
	const sessionId = body?.sessionId || event?.headers?.['x-session-id'] || event?.headers?.['X-Session-Id'];
	const session = await loadSession(sessionId);
		const systemWide = Boolean(body?.systemWide);
		const qaIntent = body?.qaIntent; // e.g., 'recipient' | 'issuer' | 'signatory' | 'date'
		const providedFileName = body?.fileName; // optional direct file name from router

	let { wantsList, wantsSystem, targetUserId, wantsRelations, wantsContext, wantsCount, wantsSummary } = parseIntent(message);
		// If router provided an explicit QA intent or filename, force single-document path
		if (qaIntent || providedFileName) {
			wantsList = false;
			wantsSystem = false;
			wantsRelations = false;
			wantsContext = false;
		}
		const scopeSystem = systemWide || wantsSystem || !!targetUserId;
		const scopeUser = targetUserId || userId || null;

	if (wantsList || wantsRelations || wantsContext || scopeSystem || wantsCount) {
			// Fetch documents for the appropriate scope
			console.log('Document Agent listing scope', { scopeSystem, scopeUser, DOCUMENTS_TABLE });
			const { items } = await listDocuments({ userId: scopeSystem && !targetUserId ? undefined : scopeUser, systemWide: scopeSystem });

			// Build relationships and insights
			const rel = buildRelationships(items);
			const summary = await generateDocumentContextSummary(items, scopeSystem);
			const insights = generateCrossDocInsights(items, rel);

			// Prepare clean document listing payload
			const docsOut = items.slice(0, 200).map((d) => ({
				userId: d.userId,
				documentId: d.documentId,
				fileName: d.fileName || (d.s3Key ? String(d.s3Key).split('/').pop() : undefined) || d.title,
				fileType: d.fileType,
				uploadedAt: d.uploadedAt,
				fileSize: d.fileSize,
				tags: ensureArray(d.tags),
				provider: d.provider || d.facility,
				description: d.description || d.summary,
			}));

			// Human-friendly list (deduped by name)
			const deduped = uniqueByFileName(docsOut);
			// Optionally enrich first 10 with S3 metadata (e.g., x-amz-meta-pages)
			const enrichLimit = Math.min(10, deduped.length);
			const enriched = [...deduped];
			try {
				await Promise.all(enriched.slice(0, enrichLimit).map(async (d, idx) => {
					const metaRes = await tryHeadForDoc(d, scopeUser);
					const meta = metaRes?.head?.Metadata || {};
					const pagesMeta = meta['pages'] || meta['page-count'] || meta['page_count'];
					if (pagesMeta) {
						enriched[idx] = { ...d, description: `${d.description || ''}`.trim() || `${pagesMeta} pages` };
						enriched[idx].__pages = pagesMeta;
					}
				}));
			} catch (_) { /* best effort */ }

			const numberedList = enriched.slice(0, 50).map((d, i) => {
				const size = bytesToHuman(d.fileSize);
				const pagesStr = d.__pages ? `${d.__pages} pages` : (String(d.description || '').match(/\b(\d{1,3})\s+pages?\b/i)?.[1] ? `${String(d.description).match(/\b(\d{1,3})\s+pages?\b/i)[1]} pages` : '');
				const trailing = [pagesStr || size].filter(Boolean).join(', ');
				return `${i + 1}. ${d.fileName}${trailing ? ` (${trailing})` : ''}`;
			}).join('\n');

			const totalCount = items.length;
			const uniqueCount = deduped.length;
			const dupCount = Math.max(0, totalCount - uniqueCount);

			const responseText = [
				'Document Context',
				wantsCount ? `You ${scopeSystem ? 'requested system-wide count' : 'uploaded'} ${totalCount} ${(totalCount === 1 ? 'document' : 'documents')}.` : '',
				wantsCount && dupCount > 0 ? `Unique files by name: ${uniqueCount} (collapsed ${dupCount} duplicate${dupCount === 1 ? '' : 's'}).` : '',
				summary,
				wantsRelations ? `Relationships: ${rel.edges.length} strong links found.` : '',
				wantsContext ? `Insights:\n${insights}` : '',
				(wantsCount || wantsList) && numberedList ? `\nDocuments:\n${numberedList}` : '',
			].filter(Boolean).join('\n\n');

			return {
				statusCode: 200,
				headers: {
					'Content-Type': 'application/json',
					'Access-Control-Allow-Origin': '*',
					'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
					'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
				},
				body: JSON.stringify({
					response: responseText,
					scope: scopeSystem ? 'system' : 'user',
					userId: scopeUser,
					counts: { documents: items.length, relationships: rel.edges.length },
					documents: docsOut,
					relationships: rel,
				}),
			};
		}

		// Single-document analysis path
	const nameMatch = message.match(/["']([^"'\n]+?)["']/) || message.match(/\b([A-Za-z0-9_\-.]+\.[A-Za-z]{2,12})\b/);
	let targetName = providedFileName || nameMatch?.[1] || session?.lastActiveFile;
		// If no filename identified and this looks like a QA, fallback to most recent document for the user
		if (!targetName && (isQuestionMessage(message) || qaIntent)) {
			const { askRecipient, askProvider } = parseCompositeQA(message);
			if (userId) {
				const { items } = await listDocuments({ userId, systemWide: false, limit: 50 });
				const sorted = (items || []).sort((a,b) => new Date(b.uploadedAt || 0) - new Date(a.uploadedAt || 0));
				if (sorted[0]?.fileName) targetName = sorted[0].fileName;
			}
		}
		if (!targetName) {
			return {
				statusCode: 200,
				headers: {
					'Content-Type': 'application/json',
					'Access-Control-Allow-Origin': '*',
					'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
					'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
				},
				body: JSON.stringify({
					response:
						"I can list documents (user or system), show relationships, or analyze a specific file. Try: 'list my documents', 'show system documents relationships', or 'analyze \"lab_results.pdf\"'.",
				}),
			};
		}

		// If no filename identified and this looks like a QA, fallback to most recent document for the user
		const { askRecipient, askProvider } = parseCompositeQA(message);
		if (!targetName && (isQuestionMessage(message) || qaIntent || askRecipient || askProvider)) {
			const { items } = await listDocuments({ userId, systemWide: false, limit: 50 });
			const sorted = (items || []).sort((a,b) => new Date(b.uploadedAt || 0) - new Date(a.uploadedAt || 0));
			if (sorted[0]?.fileName) targetName = sorted[0].fileName;
		}

	const doc = await getDocumentByName(userId, targetName);
		if (!doc) {
			return {
				statusCode: 200,
				headers: {
					'Content-Type': 'application/json',
					'Access-Control-Allow-Origin': '*',
					'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
					'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
				},
				body: JSON.stringify({ response: `I couldn't find a document named "${targetName}". Ask me to list documents to see what's available.` }),
			};
		}

		// Fetch file contents
		try {
				let bucket = doc.bucket || UPLOADS_BUCKET;
				let resolved = await resolveS3Key(bucket, doc.s3Key, doc.fileName || (doc.s3Key ? String(doc.s3Key).split('/').pop() : ''), userId);
				let s3Key = resolved.key;

				// If not found in uploads bucket, try documents bucket
				if ((!s3Key || !(await headObjectSafe(bucket, s3Key))) && DOCUMENTS_BUCKET && DOCUMENTS_BUCKET !== bucket) {
					const altResolved = await resolveS3Key(DOCUMENTS_BUCKET, doc.s3Key, doc.fileName || (doc.s3Key ? String(doc.s3Key).split('/').pop() : ''), userId);
					if (altResolved?.key && (await headObjectSafe(DOCUMENTS_BUCKET, altResolved.key))) {
						bucket = DOCUMENTS_BUCKET;
						s3Key = altResolved.key;
						resolved = altResolved;
					}
				}
				const safeName = doc.fileName || (typeof s3Key === 'string' ? String(s3Key).split('/').pop() : undefined) || targetName;

				if (!s3Key || !bucket) {
					console.error('Missing S3 location for document:', { bucket, s3Key, doc });
					return {
						statusCode: 200,
						headers: {
							'Content-Type': 'application/json',
							'Access-Control-Allow-Origin': '*',
							'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
							'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
						},
						body: JSON.stringify({ response: `I found ${safeName}, but it's missing a storage location. Try re-uploading or listing your documents.` }),
					};
				}

				const getRes = await s3.getObject({ Bucket: bucket, Key: s3Key }).promise();
				const contentType = (getRes.ContentType || doc.fileType || '').toLowerCase();
				const nameForType = (doc.fileName || (typeof s3Key === 'string' ? String(s3Key).split('/').pop() : '') || '').toLowerCase();
				const isPdf = contentType.includes('pdf') || /\.pdf$/i.test(nameForType);

				let content = '';
				if (contentType.startsWith('text/')) {
					content = (getRes.Body || Buffer.from('')).toString('utf-8');
				} else if (contentType.includes('json')) {
					try { content = JSON.stringify(JSON.parse((getRes.Body || Buffer.from('')).toString('utf-8')).slice?.(0, 1000) ?? {}, null, 2); } catch { content = (getRes.Body || Buffer.from('')).toString('utf-8'); }
				} else if (isPdf) {
					// Try to fetch extracted text from knowledge base bucket if available
					let kbTried = false;
					if (KNOWLEDGE_BASE_BUCKET && userId && doc.documentId) {
						const kbKey = `users/${userId}/documents/${doc.documentId}.txt`;
						try {
							const kbObj = await s3.getObject({ Bucket: KNOWLEDGE_BASE_BUCKET, Key: kbKey }).promise();
							content = (kbObj.Body || Buffer.from('')).toString('utf-8');
							kbTried = true;
						} catch (_) { /* fallback below */ }
					}
					if (!kbTried || !content || content === '[Binary PDF content not parsed]' || /MOCK EXTRACTION/i.test(content)) {
						// Try uploads-bucket extracted text path
						let uploadsTxt = null;
						try {
							const extractedKey = `users/${userId}/documents/${doc.documentId}.txt`;
							const kbObj2 = await s3.getObject({ Bucket: UPLOADS_BUCKET, Key: extractedKey }).promise();
							uploadsTxt = (kbObj2.Body || Buffer.from('')).toString('utf-8');
							content = uploadsTxt;
						} catch (_) { /* fallthrough to OCR */ }

						// Secondary: try legacy path 'documents/<documentId>.txt' in uploads bucket
						if (!uploadsTxt) {
							try {
								const legacyKey = `documents/${doc.documentId}.txt`;
								const obj3 = await s3.getObject({ Bucket: UPLOADS_BUCKET, Key: legacyKey }).promise();
								uploadsTxt = (obj3.Body || Buffer.from('')).toString('utf-8');
								content = uploadsTxt;
							} catch (_) { /* continue to OCR */ }
						}

						// If uploads text is missing or looks like mock/placeholder, run Textract OCR
						const isPlaceholderTxt = !uploadsTxt 
							|| /MOCK EXTRACTION|mock extraction|This is a mock extraction/i.test(uploadsTxt)
							|| /^\s*\[Binary PDF content not parsed\]\s*$/i.test(uploadsTxt)
							|| (uploadsTxt && uploadsTxt.trim().length < 40);
						if (isPlaceholderTxt) {
							// Fallback: Textract OCR (async) -> cache extracted text
							try {
								const extracted = await extractPdfTextWithTextract(bucket, s3Key, { maxWaitMs: 90000, pollMs: 2000 });
								content = extracted && extracted.trim() ? extracted : '[Binary PDF content not parsed]';
								// Cache extracted text
								if (content && !/^\[Binary/.test(content)) {
									const cacheKey = `users/${userId}/documents/${doc.documentId}.txt`;
									await s3.putObject({ Bucket: UPLOADS_BUCKET, Key: cacheKey, Body: Buffer.from(content, 'utf-8'), ContentType: 'text/plain' }).promise();
								}
							} catch (ocrErr) {
								console.warn('Textract OCR fallback failed:', ocrErr?.message);
								content = '[Binary PDF content not parsed]';
							}
						}
					}
				} else {
					// Fallback for unknown/binary types
					content = '[Binary content not parsed]';
				}

				// Decide between QA and summary based on the original user message
				// If the user explicitly asked for a summary, prefer summary over QA.
				const wantsQA = (!wantsSummary) && (isQuestionMessage(message) || Boolean(qaIntent));
				let analysis;
				if (wantsQA) {
					// Vector-augmented retrieval: get top chunks for this doc if configured
					let docChunksNote = '';
					try {
						const vec = await embedText(message);
						if (vec && doc?.documentId) {
							const chunks = await queryOpenSearchKnn({ vector: vec, docId: doc.documentId, topK: 6 });
							if (chunks?.length) {
								const joined = chunks.map((c, i) => `(${i + 1}) ${c.text}`).join('\n');
								docChunksNote = `\n\nDOCUMENT_CHUNKS (top-k):\n${joined.slice(0, 4000)}`;
							}
						}
					} catch (_) { /* optional */ }
					// Composite QA: recipient + provider
					const multi = parseCompositeQA(message);
					if (multi.askRecipient || multi.askProvider) {
						const linesOut = [];
						const ent = extractEntitiesFromContent(content, safeName);
						if (multi.askRecipient) {
							const rec = findRecipientCandidate(content);
							let name = ent?.participant || rec?.name || extractParticipantFromFilename(safeName) || null;
							name = name && looksLikePersonName(name) ? name : null;
							linesOut.push(`Recipient: ${name || 'Unknown'}`);
						}
						if (multi.askProvider) {
							const prov = findProviderCandidate(content);
							linesOut.push(`Service Provider: ${prov?.org || 'Unknown'}`);
						}
						return {
							statusCode: 200,
							headers: {
								'Content-Type': 'application/json',
								'Access-Control-Allow-Origin': '*',
								'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
								'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
							},
							body: JSON.stringify({ response: `Answer for ${safeName}\n\n${linesOut.join('\n')}` }),
						};
					}
					// Recipient-specific heuristic: return a PERSON only, or Unknown
					if (qaIntent === 'recipient') {
						const rec = findRecipientCandidate(content);
						const ent = extractEntitiesFromContent(content, safeName);
						let candidate = ent?.participant || rec?.name || extractParticipantFromFilename(safeName) || null;
						if (candidate && looksLikePersonName(candidate)) {
							const lines = String(content || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
							const evLine = lines.find(l => l.includes(candidate)) || rec?.evidence || '';
							const resp = `Answer: ${candidate}${evLine ? `\nEvidence: "${evLine.slice(0, 180)}"` : ''}`;
							return {
								statusCode: 200,
								headers: {
									'Content-Type': 'application/json',
									'Access-Control-Allow-Origin': '*',
									'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
									'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
								},
								body: JSON.stringify({ response: `Answer for ${safeName}\n\n${resp}` }),
							};
						}
						// Model-assisted, but enforce person-only + Unknown fallback
						const guidance = 'STRICT: Identify the recipient/participant (a person) the document is about. Return the person\'s full name only. If not present, return "Unknown". Never return an organization/company.';
						const q = `${guidance}\n\nUser Question: ${message}`;
						const out = await answerQuestionWithNova(`${content}${docChunksNote}`, safeName, contentType || 'unknown', q);
						// Try to extract a person from the model\'s output
						const person = extractPersonFromAnswerText(out);
						if (person && looksLikePersonName(person)) {
							// Attach brief evidence if present in content
							const lines = String(content || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
							const evLine = lines.find(l => l.includes(person)) || '';
							analysis = `Answer: ${person}${evLine ? `\nEvidence: "${evLine.slice(0, 180)}"` : ''}`;
						} else {
							analysis = 'Answer: Unknown';
						}
					} else {
						// If the question implies recipient even without explicit qaIntent, enforce person-only guardrails
						if (questionImpliesRecipient(message)) {
							const rec = findRecipientCandidate(content);
							const ent = extractEntitiesFromContent(content, safeName);
							let candidate = ent?.participant || rec?.name || extractParticipantFromFilename(safeName) || null;
							if (candidate && looksLikePersonName(candidate)) {
								const lines = String(content || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
								const evLine = lines.find(l => l.includes(candidate)) || rec?.evidence || '';
								analysis = `Answer: ${candidate}${evLine ? `\nEvidence: "${evLine.slice(0, 180)}"` : ''}`;
							} else {
								const guidance = 'STRICT: Identify the recipient/participant (a person) the document is about. Return the person\'s full name only. If not present, return "Unknown". Never return an organization/company.';
								const q = `${guidance}\n\nUser Question: ${message}`;
								const out = await answerQuestionWithNova(`${content}${docChunksNote}`, safeName, contentType || 'unknown', q);
								const person = extractPersonFromAnswerText(out);
								if (person && looksLikePersonName(person)) {
									const lines = String(content || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
									const evLine = lines.find(l => l.includes(person)) || '';
									analysis = `Answer: ${person}${evLine ? `\nEvidence: "${evLine.slice(0, 180)}"` : ''}`;
								} else {
									analysis = 'Answer: Unknown';
								}
							}
						} else {
							// If the router indicated a specific QA intent, prepend that guidance to the question for clarity
							const q = qaIntent ? `${message}\n\n(qaIntent: ${qaIntent})` : message;
							analysis = await answerQuestionWithNova(`${content}${docChunksNote}`, safeName, contentType || 'unknown', q);
						}
					}
				} else {
					// Derive meta and optionally load RAG guidance
					const hintedRegion = (body?.region || body?.country || event?.headers?.['x-enabl-region'] || '').toString();
					const { region, docType } = detectRegionAndDocType(content, safeName);
					const finalRegion = hintedRegion || region || '';
					const entities = extractEntitiesFromContent(content, safeName);
					const meta = { region: finalRegion ? finalRegion.toUpperCase() : undefined, docType, entities };
					// Save entities and active file to session
					await saveSession(sessionId, { ...(session || {}), lastActiveFile: safeName, lastEntities: entities, lastDocType: docType, lastRegion: meta.region });
					const rag = await loadRagSnippets(meta.region, docType);
					analysis = await analyzeDocumentWithNova(content, safeName, contentType || 'unknown', meta, rag);
				}

				return {
					statusCode: 200,
					headers: {
						'Content-Type': 'application/json',
						'Access-Control-Allow-Origin': '*',
						'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
						'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
					},
					body: JSON.stringify({ response: `${wantsQA ? 'Answer for' : 'Summary of'} ${safeName}\n\n${analysis}` }),
				};
			} catch (e) {
				console.error('S3 fetch/analysis error:', { message: e?.message, code: e?.code, bucket: (doc.bucket || UPLOADS_BUCKET), key: doc.s3Key });
				const safeName = doc.fileName || (typeof doc.s3Key === 'string' ? String(doc.s3Key).split('/').pop() : undefined) || targetName;
				return {
					statusCode: 200,
					headers: {
						'Content-Type': 'application/json',
						'Access-Control-Allow-Origin': '*',
						'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
						'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
					},
					body: JSON.stringify({ response: `I located ${safeName} but couldn't analyze it right now. Please try again later.` }),
				};
			}
	} catch (error) {
		console.error('Document Agent Error:', error);
		return {
			statusCode: 500,
			headers: {
				'Content-Type': 'application/json',
				'Access-Control-Allow-Origin': '*',
				'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
				'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
			},
			body: JSON.stringify({ response: 'Temporary issue accessing documents. Please try again shortly.' }),
		};
	}
}

