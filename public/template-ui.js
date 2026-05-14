// Power Agent Template UI Handler
// Manages template modal, form rendering, and query generation

class TemplateUI {
  constructor() {
    this.currentTemplate = null;
    this.answers = {};
    this.init();
  }

  init() {
    this.createModal();
    this.attachEventListeners();
  }

  createModal() {
    const modalHTML = `
      <div id="template-modal" class="modal" style="display: none;">
        <div class="modal-content template-modal-content">
          <div class="modal-header">
            <h2 id="template-title">Template</h2>
            <button class="modal-close" id="template-close">&times;</button>
          </div>
          <div class="modal-body" id="template-body">
            <!-- Template form will be rendered here -->
          </div>
          <div class="modal-footer">
            <button class="btn btn-secondary" id="template-cancel">Cancel</button>
            <button class="btn btn-primary" id="template-submit">Generate Query</button>
          </div>
        </div>
      </div>
    `;

    // Insert modal into body
    document.body.insertAdjacentHTML('beforeend', modalHTML);

    // Add styles
    this.injectStyles();
  }

  injectStyles() {
    const styles = `
      <style>
        .modal {
          position: fixed;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background: rgba(0, 0, 0, 0.5);
          z-index: 10000;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .template-modal-content {
          background: white;
          border-radius: 8px;
          max-width: 700px;
          width: 90%;
          max-height: 85vh;
          display: flex;
          flex-direction: column;
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
        }

        .modal-header {
          padding: 20px 24px;
          border-bottom: 1px solid #e0e0e0;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .modal-header h2 {
          margin: 0;
          font-size: 24px;
          color: #333;
        }

        .modal-close {
          background: none;
          border: none;
          font-size: 32px;
          color: #666;
          cursor: pointer;
          padding: 0;
          width: 32px;
          height: 32px;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .modal-close:hover {
          color: #333;
        }

        .modal-body {
          padding: 24px;
          overflow-y: auto;
          flex: 1;
        }

        .modal-footer {
          padding: 16px 24px;
          border-top: 1px solid #e0e0e0;
          display: flex;
          justify-content: flex-end;
          gap: 12px;
        }

        .template-question {
          margin-bottom: 24px;
        }

        .template-question label {
          display: block;
          font-weight: 500;
          margin-bottom: 8px;
          color: #333;
        }

        .template-question .required {
          color: #d32f2f;
        }

        .template-question input[type="text"],
        .template-question input[type="number"],
        .template-question textarea,
        .template-question select {
          width: 100%;
          padding: 10px 12px;
          border: 1px solid #ccc;
          border-radius: 4px;
          font-size: 14px;
          font-family: inherit;
        }

        .template-question textarea {
          min-height: 80px;
          resize: vertical;
        }

        .template-question .help-text {
          font-size: 13px;
          color: #666;
          margin-top: 6px;
        }

        .template-question .checkbox-group,
        .template-question .radio-group {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .template-question .checkbox-item,
        .template-question .radio-item {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .template-question input[type="checkbox"],
        .template-question input[type="radio"] {
          width: auto;
        }

        .btn {
          padding: 10px 20px;
          border: none;
          border-radius: 4px;
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
          transition: background 0.2s;
        }

        .btn-primary {
          background: #1976d2;
          color: white;
        }

        .btn-primary:hover {
          background: #1565c0;
        }

        .btn-secondary {
          background: #f5f5f5;
          color: #333;
        }

        .btn-secondary:hover {
          background: #e0e0e0;
        }

        .template-category {
          font-size: 12px;
          color: #666;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          margin-bottom: 16px;
        }

        .template-description {
          color: #666;
          margin-bottom: 24px;
          font-size: 14px;
        }
      </style>
    `;

    document.head.insertAdjacentHTML('beforeend', styles);
  }

  attachEventListeners() {
    const modal = document.getElementById('template-modal');
    const closeBtn = document.getElementById('template-close');
    const cancelBtn = document.getElementById('template-cancel');
    const submitBtn = document.getElementById('template-submit');

    // Close modal
    closeBtn.addEventListener('click', () => this.closeModal());
    cancelBtn.addEventListener('click', () => this.closeModal());

    // Click outside modal to close
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        this.closeModal();
      }
    });

    // Submit form
    submitBtn.addEventListener('click', () => this.submitTemplate());
  }

  openTemplate(templateId) {
    this.currentTemplate = POWER_AGENT_TEMPLATES.find(t => t.id === templateId);
    if (!this.currentTemplate) {
      console.error('Template not found:', templateId);
      return;
    }

    this.answers = {};
    this.renderTemplate();
    document.getElementById('template-modal').style.display = 'flex';
  }

  renderTemplate() {
    const template = this.currentTemplate;
    const titleEl = document.getElementById('template-title');
    const bodyEl = document.getElementById('template-body');

    titleEl.innerHTML = `${template.icon} ${template.title}`;

    let html = `
      <div class="template-category">Tier ${template.tier} - ${template.category}</div>
      <div class="template-description">${template.description}</div>

      <!-- Auto-Fill Section -->
      <div style="margin: 24px 0; padding: 16px; background: #f8f9fa; border: 1px solid #e0e0e0; border-radius: 8px;">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px;">
          <div style="font-weight: 600; font-size: 14px; color: #333;">✨ Quick Auto-Fill</div>
          <button
            type="button"
            class="btn btn-secondary"
            id="auto-fill-btn"
            style="padding: 6px 14px; font-size: 13px;"
          >
            ✨ Smart Fill
          </button>
        </div>
        <div style="font-size: 13px; color: #666; margin-bottom: 8px;">
          Paste all your study information below, and we'll automatically fill in the form fields:
        </div>
        <textarea
          id="auto-fill-input"
          style="width: 100%; min-height: 100px; padding: 10px; border: 1px solid #ccc; border-radius: 4px; font-size: 13px; font-family: inherit; resize: vertical;"
        >${template.autoFillExample || ''}</textarea>
        <div id="auto-fill-status" style="margin-top: 8px; font-size: 12px; display: none;"></div>
      </div>

      <div style="margin-bottom: 16px; padding-bottom: 16px; border-bottom: 2px solid #e0e0e0;">
        <div style="font-weight: 600; font-size: 14px; color: #333;">📋 Template Questions</div>
        <div style="font-size: 12px; color: #666; margin-top: 4px;">Fill in the fields below. Fields marked with <span style="color: #d32f2f;">*</span> are required.</div>
      </div>
    `;

    template.questions.forEach((question, index) => {
      html += this.renderQuestion(question, index);
    });

    bodyEl.innerHTML = html;

    // Attach input listeners
    this.attachInputListeners();

    // Attach auto-fill button listener
    this.attachAutoFillListener();
  }

  renderQuestion(question) {
    const required = question.required ? '<span class="required">*</span>' : '';
    let inputHTML = '';

    switch (question.type) {
      case 'text':
      case 'number':
        inputHTML = `
          <input
            type="${question.type}"
            id="q-${question.id}"
            placeholder="${question.placeholder || ''}"
            ${question.required ? 'required' : ''}
            ${question.validation ? this.getValidationAttrs(question.validation) : ''}
          />
        `;
        break;

      case 'textarea':
        inputHTML = `
          <textarea
            id="q-${question.id}"
            placeholder="${question.placeholder || ''}"
            ${question.required ? 'required' : ''}
          ></textarea>
        `;
        break;

      case 'select':
        inputHTML = `
          <select id="q-${question.id}" ${question.required ? 'required' : ''}>
            <option value="">Select...</option>
            ${question.options.map(opt => `
              <option value="${opt.value}">${opt.label}</option>
            `).join('')}
          </select>
        `;
        break;

      case 'checkbox':
        inputHTML = `
          <div class="checkbox-group" id="q-${question.id}">
            ${question.options.map(opt => `
              <div class="checkbox-item">
                <input type="checkbox" id="q-${question.id}-${opt.value}" value="${opt.value}" />
                <label for="q-${question.id}-${opt.value}">${opt.label}</label>
              </div>
            `).join('')}
          </div>
        `;
        break;

      case 'radio':
        inputHTML = `
          <div class="radio-group" id="q-${question.id}">
            ${question.options.map(opt => `
              <div class="radio-item">
                <input type="radio" name="q-${question.id}" id="q-${question.id}-${opt.value}" value="${opt.value}" />
                <label for="q-${question.id}-${opt.value}">${opt.label}</label>
              </div>
            `).join('')}
          </div>
        `;
        break;
    }

    return `
      <div class="template-question">
        <label>${question.label} ${required}</label>
        ${inputHTML}
        ${question.helpText ? `<div class="help-text">${question.helpText}</div>` : ''}
      </div>
    `;
  }

  getValidationAttrs(validation) {
    const attrs = [];
    if (validation.min !== undefined) attrs.push(`min="${validation.min}"`);
    if (validation.max !== undefined) attrs.push(`max="${validation.max}"`);
    if (validation.step !== undefined) attrs.push(`step="${validation.step}"`);
    return attrs.join(' ');
  }

  attachInputListeners() {
    const template = this.currentTemplate;

    template.questions.forEach(question => {
      const element = document.getElementById(`q-${question.id}`);

      if (question.type === 'checkbox') {
        // Handle checkbox group
        const checkboxes = element.querySelectorAll('input[type="checkbox"]');
        checkboxes.forEach(cb => {
          cb.addEventListener('change', () => {
            const selected = Array.from(checkboxes)
              .filter(c => c.checked)
              .map(c => c.value);
            this.answers[question.id] = selected;
          });
        });
      } else if (question.type === 'radio') {
        // Handle radio group
        const radios = element.querySelectorAll('input[type="radio"]');
        radios.forEach(r => {
          r.addEventListener('change', () => {
            if (r.checked) {
              this.answers[question.id] = r.value;
            }
          });
        });
      } else {
        // Handle text, number, textarea, select
        element.addEventListener('input', () => {
          this.answers[question.id] = element.value;
        });
      }
    });
  }

  validateAnswers() {
    const template = this.currentTemplate;
    const errors = [];

    template.questions.forEach(question => {
      if (question.required) {
        const value = this.answers[question.id];
        if (!value || (Array.isArray(value) && value.length === 0)) {
          errors.push(`${question.label} is required`);
        }
      }
    });

    if (errors.length > 0) {
      alert('Please fill in all required fields:\n\n' + errors.join('\n'));
      return false;
    }

    return true;
  }

  submitTemplate() {
    if (!this.validateAnswers()) {
      return;
    }

    // Generate query using template's buildQuery function
    const query = this.currentTemplate.buildQuery(this.answers);

    // Send to chat input
    this.sendToChat(query);

    // Close modal
    this.closeModal();
  }

  sendToChat(query) {
    const chatInput = document.getElementById('messageInput');
    if (chatInput) {
      chatInput.value = query;

      // Trigger send if send button exists
      const sendBtn = document.getElementById('sendButton');
      if (sendBtn) {
        sendBtn.click();
      }
    }
  }

  closeModal() {
    document.getElementById('template-modal').style.display = 'none';
    this.currentTemplate = null;
    this.answers = {};
  }

  attachAutoFillListener() {
    const autoFillBtn = document.getElementById('auto-fill-btn');
    if (autoFillBtn) {
      autoFillBtn.addEventListener('click', () => this.autoFillFields());
    }
  }

  async autoFillFields() {
    const input = document.getElementById('auto-fill-input');
    const statusDiv = document.getElementById('auto-fill-status');
    const btn = document.getElementById('auto-fill-btn');

    if (!input || !input.value.trim()) {
      this.showAutoFillStatus('Please enter some information to auto-fill', 'error');
      return;
    }

    const userInput = input.value.trim();

    // Disable button and show loading
    btn.disabled = true;
    btn.innerHTML = '🔄 Processing...';
    this.showAutoFillStatus('Analyzing your input...', 'loading');

    try {
      // Call LLM to parse user input into template fields
      const parsedData = await this.parseUserInputWithLLM(userInput);

      // Fill in the form fields
      this.fillFormFields(parsedData);

      // Show success message
      this.showAutoFillStatus('✅ Fields auto-filled! Please review and fill in any missing fields (marked in red).', 'success');

    } catch (error) {
      console.error('Auto-fill error:', error);
      this.showAutoFillStatus('❌ Error: ' + error.message, 'error');
    } finally {
      // Re-enable button
      btn.disabled = false;
      btn.innerHTML = '✨ Smart Fill';
    }
  }

  async parseUserInputWithLLM(userInput) {
    const template = this.currentTemplate;

    // Build a structured prompt for the LLM
    const prompt = this.buildParsingPrompt(userInput, template);

    // Call backend API to parse with LLM
    const response = await fetch('https://power-agent-api-927325869269.us-central1.run.app/api/parse-template', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        userInput: userInput,
        template: {
          title: template.title,
          questions: template.questions.map(q => ({
            id: q.id,
            label: q.label,
            type: q.type,
            required: q.required,
            options: q.options,
            placeholder: q.placeholder
          }))
        },
        prompt: prompt
      })
    });

    if (!response.ok) {
      throw new Error('Smart Fill endpoint not available. Please fill the form manually or use the example query.');
    }

    const result = await response.json();
    return result.parsedFields || {};
  }

  buildParsingPrompt(userInput, template) {
    const questionsDescription = template.questions.map(q => {
      let desc = `- ${q.id}: ${q.label}`;
      if (q.type === 'select' || q.type === 'radio' || q.type === 'checkbox') {
        desc += ` (options: ${q.options.map(opt => opt.value).join(', ')})`;
      }
      if (q.required) {
        desc += ' [REQUIRED]';
      }
      return desc;
    }).join('\n');

    return `You are a helpful assistant that extracts structured information from user input to fill a biostatistical analysis template.

**IMPORTANT INSTRUCTIONS:**
1. Be HONEST and RIGOROUS
2. Only extract information that is EXPLICITLY stated in the user input
3. Do NOT make assumptions or infer values
4. If a field's value is not clearly specified, leave it empty (null)
5. For required fields without information, still leave them empty

**OUTPUT FORMAT:**
- You MUST respond with ONLY a JSON object
- Do NOT include any explanatory text, markdown, or comments
- Do NOT use code blocks or backticks
- Start your response with { and end with }
- Return a valid JSON object only

Template: ${template.title}

Template Fields:
${questionsDescription}

User Input:
${userInput}

**Task:**
Extract values for each field based ONLY on what is explicitly stated in the user input.
Return a JSON object where keys are field IDs and values are the extracted information.
If a field's information is not found, set its value to null.

Example output (respond with ONLY the JSON, nothing else):
{
  "fieldId1": "extracted value",
  "fieldId2": null,
  "fieldId3": "another value"
}

Be precise and conservative. Do not hallucinate or guess values. Output ONLY valid JSON.`;
  }

  fillFormFields(parsedData) {
    const template = this.currentTemplate;

    template.questions.forEach(question => {
      const value = parsedData[question.id];
      const element = document.getElementById(`q-${question.id}`);

      if (!element) return;

      // Track which fields were filled
      let wasFilled = false;

      if (value !== null && value !== undefined && value !== '') {
        if (question.type === 'checkbox') {
          // Handle checkbox group
          const values = Array.isArray(value) ? value : [value];
          const checkboxes = element.querySelectorAll('input[type="checkbox"]');
          checkboxes.forEach(cb => {
            if (values.includes(cb.value)) {
              cb.checked = true;
              wasFilled = true;
            }
          });
          if (wasFilled) {
            this.answers[question.id] = values;
          }
        } else if (question.type === 'radio') {
          // Handle radio group
          const radios = element.querySelectorAll('input[type="radio"]');
          radios.forEach(r => {
            if (r.value === value) {
              r.checked = true;
              wasFilled = true;
              this.answers[question.id] = value;
            }
          });
        } else {
          // Handle text, number, textarea, select
          let processedValue = value;

          // For number inputs, strip percentage signs and parse to number
          if (element.type === 'number' && typeof value === 'string') {
            if (value.endsWith('%')) {
              processedValue = value.replace('%', '').trim();
            }
          }

          element.value = processedValue;
          wasFilled = true;
          this.answers[question.id] = processedValue;

          // Remove any previous error styling
          element.style.borderColor = '#4caf50';
          element.style.borderWidth = '2px';
        }
      }

      // If field was not filled and is required, highlight in red
      if (!wasFilled && question.required) {
        element.style.borderColor = '#d32f2f';
        element.style.borderWidth = '2px';
        element.style.backgroundColor = '#ffebee';

        // Add a warning badge
        const questionDiv = element.closest('.template-question');
        if (questionDiv && !questionDiv.querySelector('.missing-field-warning')) {
          const warning = document.createElement('div');
          warning.className = 'missing-field-warning';
          warning.style.cssText = 'color: #d32f2f; font-size: 12px; margin-top: 4px; font-weight: 500;';
          warning.innerHTML = '⚠️ Required field - not found in your input';
          questionDiv.appendChild(warning);
        }
      }
    });
  }

  showAutoFillStatus(message, type) {
    const statusDiv = document.getElementById('auto-fill-status');
    if (!statusDiv) return;

    statusDiv.style.display = 'block';
    statusDiv.textContent = message;

    // Style based on type
    if (type === 'error') {
      statusDiv.style.color = '#d32f2f';
      statusDiv.style.background = '#ffebee';
      statusDiv.style.border = '1px solid #d32f2f';
    } else if (type === 'success') {
      statusDiv.style.color = '#2e7d32';
      statusDiv.style.background = '#e8f5e9';
      statusDiv.style.border = '1px solid #2e7d32';
    } else if (type === 'loading') {
      statusDiv.style.color = '#1976d2';
      statusDiv.style.background = '#e3f2fd';
      statusDiv.style.border = '1px solid #1976d2';
    }

    statusDiv.style.padding = '8px 12px';
    statusDiv.style.borderRadius = '4px';
  }
}

// Initialize template UI when DOM is ready
let templateUI;
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    templateUI = new TemplateUI();
  });
} else {
  templateUI = new TemplateUI();
}

// Export for external use
window.openTemplate = function(templateId) {
  if (templateUI) {
    templateUI.openTemplate(templateId);
  }
};
