# Job Application Form — Resume Upload: Execution Plan

**Date:** 2026-05-07  
**Branch:** kev-0505  
**Author:** Kevin Wong  

---

## Current Infrastructure Context

### Form
- **File:** `en/about-us/job-listings.html`
- **Form ID:** `#wf-form-Job-Application-Form`
- **Native action:** `http://ioioleo.com/form-webmailContacts.asp` (bypassed via JS)
- **Fields:** First Name, Last Name, Email, Phone, Job Position (dropdown), Company (auto-filled), Message

### Form Submission Flow
```
User fills form
  → reCAPTCHA v3 token generated (grecaptcha.execute)
    → submitToAPI(e) called
      → jQuery AJAX POST (async: false)
        → AWS Lambda (ap-southeast-1)
          → Lambda sends email via SES/SMTP
```

### Lambda Endpoint
```
POST https://uudwr4nux0.execute-api.ap-southeast-1.amazonaws.com/APIStage/contactus
```
**Payload fields:**
```json
{
  "firstName": "",
  "lastName": "",
  "email": "",
  "phone": "",
  "position": "",
  "company": "",
  "message": "",
  "htmlContent": "",
  "recaptchaToken": "",
  "Iswebflow": 1,
  "toRecipient": 22,
  "emailSubject": "Job Application Form",
  "ccRecipient": 0,
  "bccRecipient": 1
}
```

**Recipient routing logic (in `js/job-listings.js`):**
| Company | `toRecipient` |
|---|---|
| IOI Acidchem Sdn. Bhd. / IOI Esterchem (M) Sdn. Bhd. | `22` |
| IOI Pan-Century Edible Oils / Oleochemicals Sdn. Bhd. | `23` |
| Anything else | Aborts with alert |

### Key JS File
- **`js/job-listings.js`** — contains `submitToAPI()`, reCAPTCHA binding, job toggle accordion, CMSSelect sync

### Constraints
- No server-side backend under our control (ASP at `ioioleo.com` is legacy, not used)
- Lambda source code is managed externally (AWS console or IaC)
- Static site: no Node.js server, no PHP — only HTML/CSS/JS
- File size limit target: **5 MB**
- Supported file types: **PDF, DOC, DOCX**
- Must not break existing reCAPTCHA → submitToAPI flow

---

## Option 1: AWS S3 Pre-signed URL Upload

### Overview
A second Lambda function generates a temporary pre-signed S3 upload URL. The frontend uploads the file directly to S3 using that URL, then passes the resulting S3 object URL to `submitToAPI()` as an additional field. The existing Lambda email function includes the resume URL in the email body.

### Architecture Diagram
```
[Browser]
  │
  ├─1─► POST /getUploadUrl (new Lambda)
  │        └─► Returns { uploadUrl, fileUrl }
  │
  ├─2─► PUT {uploadUrl} ← file binary (direct to S3, no Lambda)
  │
  └─3─► POST /contactus (existing Lambda)
           └─► Email includes fileUrl as clickable link
```

---

### Phase A — AWS Infrastructure Setup

#### A1. Create S3 Bucket
- **Bucket name:** `ioi-oleochemical-job-applications` (or similar)
- **Region:** `ap-southeast-1` (match existing Lambda region)
- **Block public access:** Keep ON (files accessed via pre-signed URL only)
- **Versioning:** Optional, recommended OFF for simplicity
- **CORS configuration** (required for browser PUT upload):
```json
[
  {
    "AllowedHeaders": ["*"],
    "AllowedMethods": ["PUT"],
    "AllowedOrigins": [
      "https://www.ioioleochemical.com",
      "https://ioioleochemical.com",
      "http://localhost:*"
    ],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```
- **Object expiry lifecycle rule:** Auto-delete objects after 90 days (optional, keeps storage costs minimal)

#### A2. Create IAM Policy for Pre-sign Lambda
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:PutObject"],
      "Resource": "arn:aws:s3:::ioi-oleochemical-job-applications/resumes/*"
    }
  ]
}
```
- Attach to a new IAM role: `LambdaJobResumeUploadRole`

#### A3. Create New Lambda — `getJobResumeUploadUrl`
- **Runtime:** Node.js 20.x
- **Region:** `ap-southeast-1`
- **Trigger:** API Gateway (same gateway as existing `/contactus`, new route `/getUploadUrl`)
- **Memory:** 128 MB, **Timeout:** 10s

**Lambda source (`getJobResumeUploadUrl/index.mjs`):**
```javascript
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "crypto";

const s3 = new S3Client({ region: "ap-southeast-1" });
const BUCKET = "ioi-oleochemical-job-applications";
const ALLOWED_TYPES = ["application/pdf", "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document"];
const MAX_SIZE = 5 * 1024 * 1024; // 5 MB

export const handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json"
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { body = {}; }

  const { fileName, fileType, fileSize } = body;

  if (!fileName || !fileType || !fileSize) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing fileName, fileType, or fileSize" }) };
  }
  if (!ALLOWED_TYPES.includes(fileType)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "File type not allowed. Only PDF, DOC, DOCX." }) };
  }
  if (fileSize > MAX_SIZE) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "File exceeds 5 MB limit." }) };
  }

  const ext = fileName.split(".").pop().toLowerCase();
  const key = `resumes/${Date.now()}-${randomUUID()}.${ext}`;

  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    ContentType: fileType,
    ContentLength: fileSize,
    // No ACL — bucket stays private
  });

  const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 300 }); // 5 min TTL
  const fileUrl = `https://${BUCKET}.s3.ap-southeast-1.amazonaws.com/${key}`;

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ uploadUrl, fileUrl })
  };
};
```

#### A4. Add API Gateway Route
- **Method:** `POST`
- **Path:** `/getUploadUrl`
- **Stage:** `APIStage` (same as existing)
- **Full URL:** `https://uudwr4nux0.execute-api.ap-southeast-1.amazonaws.com/APIStage/getUploadUrl`
- Enable CORS on this route in API Gateway console

#### A5. Update Existing Lambda (`/contactus`)
Add `resumeUrl` field handling to the email body construction:
```javascript
// In existing Lambda email body builder:
if (data.resumeUrl) {
  htmlContent += `Resume: <a href="${data.resumeUrl}">${data.resumeUrl}</a><br/><br/>`;
}
```

---

### Phase B — Frontend Changes

#### B1. Add File Input to Form in `en/about-us/job-listings.html`
Locate the job application form and add before the submit button:

```html
<!-- Resume Upload -->
<div class="form_field-wrapper">
  <label for="Applicant-Resume" class="form_label">
    Resume / CV <span style="font-weight:400;color:#888;">(PDF, DOC, DOCX — max 5MB)</span>
  </label>
  <input
    type="file"
    id="Applicant-Resume"
    name="Applicant-Resume"
    accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    class="form_input w-input"
    style="padding: 0.5rem;"
  />
  <div id="resume-upload-status" style="font-size:0.8rem;margin-top:0.25rem;color:#555;"></div>
</div>
```

#### B2. Update `js/job-listings.js`

**Add constants near top of file (after `let lenis;`):**
```javascript
var UPLOAD_URL_ENDPOINT = 'https://uudwr4nux0.execute-api.ap-southeast-1.amazonaws.com/APIStage/getUploadUrl';
var resumeS3Url = ''; // Global to hold uploaded resume URL
```

**Add `uploadResume()` helper function before `submitToAPI()`:**
```javascript
function uploadResume(file) {
  return new Promise(function(resolve, reject) {
    var statusEl = document.getElementById('resume-upload-status');
    if (statusEl) statusEl.textContent = 'Uploading resume...';

    $.ajax({
      type: 'POST',
      url: UPLOAD_URL_ENDPOINT,
      contentType: 'application/json; charset=utf-8',
      data: JSON.stringify({
        fileName: file.name,
        fileType: file.type,
        fileSize: file.size
      }),
      dataType: 'json',
      success: function(res) {
        if (!res.uploadUrl || !res.fileUrl) {
          reject(new Error('Invalid pre-sign response'));
          return;
        }
        // Upload file directly to S3 via PUT
        $.ajax({
          type: 'PUT',
          url: res.uploadUrl,
          contentType: file.type,
          data: file,
          processData: false,
          success: function() {
            if (statusEl) statusEl.textContent = 'Resume uploaded ✓';
            resolve(res.fileUrl);
          },
          error: function(xhr) {
            reject(new Error('S3 upload failed: ' + xhr.status));
          }
        });
      },
      error: function(xhr) {
        reject(new Error('Pre-sign request failed: ' + xhr.status));
      }
    });
  });
}
```

**Modify the form `submit` event handler** (inside the `forms.forEach` block) to upload file first:
```javascript
forms.forEach(function(form) {
  form.addEventListener('submit', function(e) {
    var tokenField = form.querySelector('#g-recaptcha-response');
    e.preventDefault();

    var fileInput = document.getElementById('Applicant-Resume');
    var file = fileInput && fileInput.files && fileInput.files[0];

    function proceedWithSubmit() {
      try {
        grecaptcha.ready(function() {
          grecaptcha.execute(SITE_KEY, { action: 'contact' }).then(function(token) {
            tokenField.value = token;
            return submitToAPI(e);
          });
        });
      } catch(exp) {
        console.log('Error: ' + exp.message);
        return false;
      }
    }

    if (file) {
      uploadResume(file).then(function(s3Url) {
        resumeS3Url = s3Url;
        proceedWithSubmit();
      }).catch(function(err) {
        alert('Failed to upload resume: ' + err.message + '\nPlease try again.');
      });
    } else {
      resumeS3Url = '';
      proceedWithSubmit();
    }
  });
});
```

**Update `submitToAPI()` to include `resumeUrl`:**
```javascript
// After:  data.message = externalMessage;
data.resumeUrl = resumeS3Url || '';

// Update htmlContent to include resume link:
var emailContent = 'First Name : ' + externalFirstName + '<br /><br />' +
  'Last Name : ' + externalLastName + '<br /><br />' +
  'Phone : ' + externalPhone + '<br /><br />' +
  'Email : ' + externalEmail + '<br /><br />' +
  'Position : ' + externalPosition + '<br /><br />' +
  'Company : ' + externalCompany + '<br /><br />' +
  'Message : ' + externalMessage + '<br /><br />' +
  (resumeS3Url ? 'Resume : <a href="' + resumeS3Url + '">' + resumeS3Url + '</a><br /><br />' : '');
```

---

### Phase C — Validation & UX

- Client-side file type check before upload attempt
- Client-side file size check (< 5 MB) before upload attempt
- Upload status indicator (`#resume-upload-status`)
- Submit button disabled during upload (optional UX improvement)
- Resume field is **optional** — form submits normally if no file selected

---

### Option 1 — Pros & Cons

| | |
|---|---|
| ✅ No third-party dependency | ✅ Files stay within AWS ecosystem |
| ✅ Integrates with existing Lambda infra | ✅ Controlled access, no public bucket |
| ✅ No ongoing per-upload cost beyond S3 storage | ❌ Requires AWS access to create Lambda + S3 + IAM |
| ❌ More setup steps | ❌ CORS config must be exact |
| ❌ Pre-signed URL has 5-min TTL (user must upload quickly) | |

---
---

## Option 3: Third-Party Upload Service (Filestack / Uploadcare)

### Overview
Embed a third-party file upload widget directly in the form. The widget handles S3/CDN upload internally and returns a public CDN URL. That URL is injected into the form submission payload. No new Lambda or S3 bucket required.

**Recommended service: [Filestack](https://www.filestack.com)**
- Free tier: 100 uploads/month, 1 GB storage
- Paid: from ~$49/month
- Simple JS SDK, no backend changes required

**Alternative: [Uploadcare](https://uploadcare.com)**
- Free tier: 3,000 uploads/month, 3 GB storage
- Slightly more generous free tier

---

### Phase A — Service Account Setup (Filestack example)

1. Register at [filestack.com](https://www.filestack.com)
2. Create an application → copy the **API Key** (e.g. `Axxxxxxxxxxxxxxxxxxx`)
3. In Security settings:
   - Add allowed domains: `ioioleochemical.com`, `www.ioioleochemical.com`
   - Set max file size: `5242880` (5 MB)
   - Allowed MIME types: `application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document`

---

### Phase B — Frontend Integration

#### B1. Add Filestack SDK to `en/about-us/job-listings.html`
Add in `<head>` or just before `</body>`:
```html
<script src="https://static.filestackapi.com/filestack-js/3.x.x/filestack.min.js"></script>
```

#### B2. Add Upload Widget to Form
Replace the standard file input with a button-triggered Filestack picker:
```html
<!-- Resume Upload (Filestack) -->
<div class="form_field-wrapper">
  <label class="form_label">
    Resume / CV <span style="font-weight:400;color:#888;">(PDF, DOC, DOCX — max 5MB)</span>
  </label>
  <button type="button" id="resumePickerBtn" class="button is-secondary" style="margin-top:0.5rem;">
    📎 Attach Resume
  </button>
  <div id="resume-upload-status" style="font-size:0.8rem;margin-top:0.5rem;color:#555;"></div>
  <!-- Hidden field to carry the CDN URL into submitToAPI -->
  <input type="hidden" id="Applicant-Resume-Url" name="Applicant-Resume-Url" value="" />
</div>
```

#### B3. Add to `js/job-listings.js`

**Add Filestack initialisation inside `$(function(){...})`:**
```javascript
var FILESTACK_API_KEY = 'YOUR_FILESTACK_API_KEY';
var filestackClient = null;
var resumeCdnUrl = '';

if (typeof filestack !== 'undefined') {
  filestackClient = filestack.init(FILESTACK_API_KEY);

  document.getElementById('resumePickerBtn').addEventListener('click', function() {
    filestackClient.picker({
      accept: ['application/pdf', 'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
      maxSize: 5 * 1024 * 1024,
      maxFiles: 1,
      onUploadDone: function(result) {
        if (result.filesUploaded && result.filesUploaded.length > 0) {
          var f = result.filesUploaded[0];
          resumeCdnUrl = f.url;
          document.getElementById('Applicant-Resume-Url').value = resumeCdnUrl;
          var statusEl = document.getElementById('resume-upload-status');
          if (statusEl) statusEl.textContent = '✓ Attached: ' + f.filename;
        }
      },
      onFileUploadFailed: function(file, err) {
        alert('Upload failed: ' + err.message);
      }
    }).open();
  });
}
```

**Update `submitToAPI()` to read CDN URL:**
```javascript
var externalResumeUrl = $('#Applicant-Resume-Url').val() || '';
data.resumeUrl = externalResumeUrl;

// In emailContent:
var emailContent = /* ... existing fields ... */ +
  (externalResumeUrl ? 'Resume : <a href="' + externalResumeUrl + '">' + externalResumeUrl + '</a><br /><br />' : '');
```

**Update existing Lambda (`/contactus`)** — same as Option 1 Phase A5:
```javascript
if (data.resumeUrl) {
  htmlContent += `Resume: <a href="${data.resumeUrl}">${data.resumeUrl}</a><br/><br/>`;
}
```

---

### Option 3 Variants — Uploadcare

If Uploadcare is preferred over Filestack:

```html
<!-- In <head> -->
<script src="https://ucarecdn.com/libs/widget/3.x/uploadcare.full.min.js" charset="utf-8"></script>
```

```html
<!-- In form -->
<input type="hidden" role="uploadcare-uploader"
  id="Applicant-Resume-UC"
  data-public-key="YOUR_UPLOADCARE_PUBLIC_KEY"
  data-tabs="file"
  data-max-size="5242880"
  data-images-only="false"
/>
```

```javascript
// In js/job-listings.js
var widget = uploadcare.Widget('#Applicant-Resume-UC');
widget.onUploadComplete(function(fileInfo) {
  document.getElementById('Applicant-Resume-Url').value = fileInfo.cdnUrl;
  document.getElementById('resume-upload-status').textContent = '✓ Attached: ' + fileInfo.name;
});
```

---

### Option 3 — Pros & Cons

| | |
|---|---|
| ✅ No AWS setup required | ✅ Free tier sufficient for low-volume hiring |
| ✅ Widget handles UX (progress, retry, cancel) | ✅ No new Lambda or S3 bucket |
| ✅ Fast to implement (1–2 hours) | ❌ Third-party dependency (vendor lock-in) |
| ❌ Files stored on Filestack/Uploadcare CDN (not in-house) | ❌ Free tier limits (100 uploads/month Filestack) |
| ❌ Additional paid subscription if volume grows | ❌ CDN URLs are public (anyone with URL can access) |

---

## Comparison Summary

| | Option 1 (S3 Pre-signed URL) | Option 3 (Filestack/Uploadcare) |
|---|---|---|
| **Setup complexity** | High (Lambda + S3 + IAM + CORS) | Low (API key + script tag) |
| **Time to implement** | ~2–3 days | ~2–4 hours |
| **AWS cost** | ~$0.023/GB S3 storage (negligible) | $0 (free tier) or $49+/mo |
| **File privacy** | Private (pre-signed URL access only) | Semi-public CDN URL |
| **Data residency** | AWS ap-southeast-1 (in-region) | Filestack US/EU CDN |
| **Maintenance** | Self-managed | Vendor-managed |
| **Recommended for** | Long-term, privacy-conscious | Fast MVP or low-budget |

---

## Recommended Implementation Order

### If proceeding with Option 1 (S3):
1. Provision S3 bucket + CORS (30 min)
2. Create IAM role + policy (15 min)
3. Deploy `getJobResumeUploadUrl` Lambda + API Gateway route (45 min)
4. Update existing `/contactus` Lambda to render `resumeUrl` in email (15 min)
5. Add file input HTML to `job-listings.html` (15 min)
6. Update `job-listings.js` with `uploadResume()` + modified submit handler (1 hr)
7. Test end-to-end (30 min)

### If proceeding with Option 3 (Filestack):
1. Register Filestack account + configure domain/size restrictions (15 min)
2. Add Filestack SDK `<script>` to `job-listings.html` (5 min)
3. Add picker button + hidden URL field to form HTML (15 min)
4. Add Filestack init + picker handler to `job-listings.js` (30 min)
5. Update `submitToAPI()` to include `resumeUrl` (15 min)
6. Update `/contactus` Lambda to render `resumeUrl` in email body (15 min)
7. Test end-to-end (30 min)

---

## Files to Modify (Either Option)

| File | Change |
|---|---|
| `en/about-us/job-listings.html` | Add file input / upload widget to form |
| `js/job-listings.js` | Add upload logic, update `submitToAPI()` |
| AWS Lambda `/contactus` | Add `resumeUrl` to email HTML output |
| *(Option 1 only)* New Lambda `getJobResumeUploadUrl` | Create new function |
| *(Option 1 only)* S3 bucket | Create with CORS |
| *(Option 3 only)* Filestack/Uploadcare account | Register and configure |

---

*End of plan. No changes have been made to the codebase. This document is for planning purposes only.*
