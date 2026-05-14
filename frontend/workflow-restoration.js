/**
 * Workflow Restoration Module
 * Reconstructs agent workflow UI from stored database steps
 */

/**
 * Restore complete workflow from database steps
 * @param {Array} steps - Workflow steps from database
 * @param {string} currentAgentMsgId - Current agent message container ID
 * @returns {Object} Restoration summary
 */
function restoreWorkflowSteps(steps, currentAgentMsgId) {
    if (!steps || steps.length === 0) {
        console.log('📋 No workflow steps to restore');
        return { restored: 0, iterations: 0 };
    }

    console.log(`📋 Restoring ${steps.length} workflow steps...`);

    const contentDiv = document.getElementById(`content-${currentAgentMsgId}`);
    if (!contentDiv) {
        console.error('❌ Could not find content div for agent message');
        return { restored: 0, iterations: 0 };
    }

    // Group steps by iteration
    const stepsByIteration = {};
    steps.forEach(step => {
        const iter = step.iteration || 0;
        if (!stepsByIteration[iter]) {
            stepsByIteration[iter] = [];
        }
        stepsByIteration[iter].push(step);
    });

    const maxIteration = Math.max(...Object.keys(stepsByIteration).map(Number));
    let restoredCount = 0;

    // Restore steps iteration by iteration
    for (const [iteration, iterSteps] of Object.entries(stepsByIteration)) {
        const iterNum = parseInt(iteration);

        // Skip iteration 0 (pre-iteration steps like init)
        if (iterNum === 0) {
            iterSteps.forEach(step => {
                try {
                    restoreSingleStep(contentDiv, step, currentAgentMsgId, null);
                    restoredCount++;
                } catch (error) {
                    console.error(`❌ Error restoring step:`, error);
                }
            });
            continue;
        }

        // Create iteration container if it has steps that should be displayed
        // Expanded list to ensure no iteration steps are dropped
        const hasDisplayableSteps = iterSteps.some(s =>
            ['thinking', 'code', 'executing', 'reviewing', 'reasoning',
             'insights', 'outputs', 'summary', 'error', 'needs_info',
             'chatbot_conclusion_complete'].includes(s.step_type)
        );

        if (hasDisplayableSteps) {
            // CRITICAL FIX: Use same ID format as live rendering (iter- not iteration-)
            const iterationId = `iter-${currentAgentMsgId}-${iterNum}`;

            // Check if iteration container already exists
            let iterContainer = document.getElementById(iterationId);
            if (!iterContainer) {
                // All iterations should be expanded when restoring to match live experience
                iterContainer = document.createElement('div');
                iterContainer.id = iterationId;
                iterContainer.className = 'iteration-container'; // No 'collapsed' - show all iterations
                // CRITICAL FIX: Match live rendering - iteration-content needs id for toggleIteration
                iterContainer.innerHTML = `
                    <div class="iteration-header" onclick="toggleIteration('${iterationId}')">
                        <span class="iteration-badge">📊 Iteration ${iterNum}</span>
                        <span class="iteration-toggle">▼</span>
                    </div>
                    <div class="iteration-content" id="steps-${iterationId}"></div>
                `;
                contentDiv.appendChild(iterContainer);
            }

            // Restore each step in the iteration
            const iterContent = iterContainer.querySelector('.iteration-content');
            iterSteps.forEach(step => {
                try {
                    restoreSingleStep(iterContent, step, currentAgentMsgId, iterationId);
                    restoredCount++;
                } catch (error) {
                    console.error(`❌ Error restoring step:`, error);
                }
            });
        }
    }

    console.log(`✅ Restored ${restoredCount} workflow steps (${maxIteration} iterations)`);

    return {
        restored: restoredCount,
        iterations: maxIteration,
        stepsByIteration
    };
}

/**
 * Restore a single workflow step
 * @param {HTMLElement} container - Container to append step to
 * @param {Object} step - Workflow step from database
 * @param {string} messageId - Message ID
 * @param {string} iterationId - Iteration container ID (if applicable)
 */
function restoreSingleStep(container, step, messageId, iterationId) {
    let { step_type, step_data, status, iteration } = step;

    // Parse step_data if it's a string
    if (typeof step_data === 'string') {
        try {
            step_data = JSON.parse(step_data);
        } catch (e) {
            console.error(`Failed to parse step_data for ${step_type}:`, e);
        }
    }

    // CRITICAL FIX: When RESTORING a finished workflow, force ALL steps to 'completed'
    // The 'running' status is only meaningful during LIVE execution, not restoration
    // Only preserve 'error' status as that indicates a genuine failure
    const effectiveStatus = (status === 'error' || step_data?.status === 'error') ? 'error' : 'completed';

    // CRITICAL FIX: Generate step ID to match live rendering format
    // Live format: step-${messageId}-${iteration}-${step_type} or step-${messageId}-${step_type}
    const stepId = iteration
        ? `step-${messageId}-${iteration}-${step_type}`
        : `step-${messageId}-${step_type}`;

    // CRITICAL FIX: Remove any existing element with this ID before creating new one
    // This ensures we only show the latest version of each step (matching live behavior
    // where subsequent SSE events update the same DOM element)
    const existingElement = document.getElementById(stepId);
    if (existingElement) {
        existingElement.remove();
    }

    switch (step_type) {
        case 'pi_routing':
            restorePIRoutingStep(container, step_data, effectiveStatus, stepId);
            break;

        case 'pi_answer':
            restorePIAnswerStep(container, step_data, effectiveStatus, stepId);
            break;

        case 'thinking':
            restoreThinkingStep(container, step_data, iterationId, effectiveStatus, stepId);
            break;

        case 'code':
            restoreCodeStep(container, step_data, iterationId, effectiveStatus, stepId);
            break;

        case 'executing':
            restoreExecutingStep(container, step_data, iterationId, effectiveStatus, stepId);
            break;

        case 'reviewing':
            restoreReviewingStep(container, step_data, iterationId, effectiveStatus, stepId);
            break;

        case 'insights':
            restoreFinalInsights(container, step_data, effectiveStatus, stepId);
            break;

        case 'needs_info':
            restoreNeedsInfoStep(container, step_data, effectiveStatus, stepId);
            break;

        case 'error':
            restoreErrorStep(container, step_data, iterationId, effectiveStatus, stepId);
            break;

        case 'reasoning':
            restoreReasoningStep(container, step_data, iterationId, effectiveStatus, stepId);
            break;

        case 'clarification':
            restoreClarificationStep(container, step_data, effectiveStatus, stepId);
            break;

        case 'consultation':
            // Expert consultation - uses generic step structure like live
            restoreGenericStep(container, step_data, effectiveStatus, stepId);
            break;

        case 'init':
            // Init marker - no UI needed
            break;

        case 'summary':
            // Summary step - rendered as part of insights
            break;

        case 'outputs':
            restoreOutputsStep(container, step_data, effectiveStatus, stepId);
            break;

        case 'domain_expert_analysis':
            restoreDomainExpertStep(container, step_data, iterationId, effectiveStatus, stepId);
            break;

        case 'domain_expert_ready':
            restoreDomainExpertReadyStep(container, step_data, effectiveStatus, stepId);
            break;

        case 'chatbot_intro_start':
            // Skip start marker - we only need the complete version
            break;

        case 'chatbot_intro_stream':
            // Skip intermediate streaming - we only need the complete version
            break;

        case 'chatbot_intro_complete':
            restoreChatbotIntroCompleteStep(container, step_data, stepId);
            break;

        case 'chatbot_conclusion_start':
            // Skip start marker - we only need the complete version
            break;

        case 'chatbot_conclusion_stream':
            // Skip intermediate streaming - we only need the complete version
            break;

        case 'chatbot_conclusion_complete':
            // CRITICAL FIX: Only restore the complete version to avoid duplicates
            restoreChatbotConclusionCompleteStep(container, step_data, stepId);
            break;

        case 'complete':
            // Complete marker - no UI needed
            break;

        default:
            console.warn(`⚠️  Unknown step type: ${step_type}`);
    }
}

// ========================================
// Step-Specific Restoration Functions
// ========================================

function restorePIRoutingStep(container, data, effectiveStatus = 'completed', stepId = null) {
    const div = document.createElement('div');
    div.className = `step ${effectiveStatus}`;
    if (stepId) div.id = stepId;

    // Unescape newlines in reasoning
    const cleanReasoning = data.reasoning ? data.reasoning.replace(/\\n/g, '\n') : '';

    // CRITICAL: Match live addStepToIteration structure EXACTLY
    let html = `
        <div class="step-header">
            <div class="step-icon ${effectiveStatus}">
                ${effectiveStatus === 'running' ? '⟳' : effectiveStatus === 'completed' ? '✓' : effectiveStatus === 'error' ? '✗' : '○'}
            </div>
            <div class="step-content">
                <div class="step-title">${data.title || 'Processing...'}</div>
                ${data.message ? `<div class="step-message">${escapeHtml(data.message)}</div>` : ''}
            </div>
        </div>
    `;

    // Add reasoning dropdown matching live structure exactly
    if (cleanReasoning) {
        html += `
            <div class="step-reasoning">
                <div class="reasoning-toggle" onclick="toggleReasoning(this)">
                    <div class="reasoning-toggle-label">
                        <span>🧠</span>
                        <span>Agent Thinking Process</span>
                    </div>
                    <span class="reasoning-toggle-icon">▼</span>
                </div>
                <div class="reasoning-content">
                    <div class="reasoning-content-inner">${renderMarkdown(cleanReasoning)}</div>
                </div>
            </div>
        `;
    }

    div.innerHTML = html;
    container.appendChild(div);
}

function restorePIAnswerStep(container, data, effectiveStatus = 'completed', stepId = null) {
    const div = document.createElement('div');
    div.className = `step ${effectiveStatus}`;
    if (stepId) div.id = stepId;

    // Unescape newlines from database storage
    const cleanContent = (data.content || data.message || '').replace(/\\n/g, '\n');

    // CRITICAL: Match live addStepToIteration structure EXACTLY
    div.innerHTML = `
        <div class="step-header">
            <div class="step-icon ${effectiveStatus}">
                ${effectiveStatus === 'running' ? '⟳' : effectiveStatus === 'completed' ? '✓' : effectiveStatus === 'error' ? '✗' : '○'}
            </div>
            <div class="step-content">
                <div class="step-title">${data.title || 'Processing...'}</div>
                ${cleanContent ? `<div class="step-message">${escapeHtml(cleanContent)}</div>` : ''}
            </div>
        </div>
    `;
    container.appendChild(div);
}

function restoreThinkingStep(container, data, iterationId, effectiveStatus = 'completed', stepId = null) {
    const div = document.createElement('div');
    div.className = `step ${effectiveStatus}`;
    if (stepId) div.id = stepId;

    // CRITICAL: Match live addStepToIteration structure EXACTLY
    let html = `
        <div class="step-header">
            <div class="step-icon ${effectiveStatus}">
                ${effectiveStatus === 'running' ? '⟳' : effectiveStatus === 'completed' ? '✓' : effectiveStatus === 'error' ? '✗' : '○'}
            </div>
            <div class="step-content">
                <div class="step-title">${data.title || 'Processing...'}</div>
                ${data.message ? `<div class="step-message">${escapeHtml(data.message)}</div>` : ''}
            </div>
        </div>
    `;

    if (data.reasoning) {
        // Unescape newlines from database storage
        const cleanReasoning = data.reasoning.replace(/\\n/g, '\n');

        // CRITICAL FIX: Match live rendering - reasoning starts expanded (visible)
        html += `
            <div class="step-reasoning">
                <div class="reasoning-toggle" onclick="toggleReasoning(this)">
                    <div class="reasoning-toggle-label">
                        <span>🧠</span>
                        <span>Agent Thinking Process</span>
                    </div>
                    <span class="reasoning-toggle-icon">▼</span>
                </div>
                <div class="reasoning-content">
                    <div class="reasoning-content-inner">${renderMarkdown(cleanReasoning)}</div>
                </div>
            </div>
        `;
    }

    div.innerHTML = html;
    container.appendChild(div);
}

function restoreCodeStep(container, data, iterationId, effectiveStatus = 'completed', stepId = null) {
    const div = document.createElement('div');
    div.className = `step ${effectiveStatus}`;
    if (stepId) div.id = stepId;

    const codeId = `code-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // CRITICAL: Match live addStepToIteration structure EXACTLY
    let html = `
        <div class="step-header">
            <div class="step-icon ${effectiveStatus}">
                ${effectiveStatus === 'running' ? '⟳' : effectiveStatus === 'completed' ? '✓' : effectiveStatus === 'error' ? '✗' : '○'}
            </div>
            <div class="step-content">
                <div class="step-title">${data.title || 'Processing...'}</div>
                ${data.message ? `<div class="step-message">${escapeHtml(data.message)}</div>` : ''}
            </div>
        </div>
    `;

    if (data.code) {
        html += `
            <button class="toggle-code-btn" onclick="toggleCodeBlock('${codeId}')">
                📄 Show Code ▼
            </button>
            <div id="${codeId}" class="code-block-container" style="display: none;">
                <pre><code class="language-r">${escapeHtml(data.code)}</code></pre>
            </div>
        `;
    }

    // CRITICAL: Match live rendering - add output section
    if (data.output) {
        const outputText = Array.isArray(data.output) ? data.output.join('\n') : data.output;
        html += `<div class="step-output">${escapeHtml(outputText)}</div>`;
    }

    // CRITICAL: Match live rendering - add warnings section
    if (data.warnings && data.warnings.length > 0) {
        html += `<div class="step-output" style="background:#fef2f2;border-color:#fca5a5;color:#991b1b;">⚠️ ${escapeHtml(data.warnings.join('\n'))}</div>`;
    }

    // CRITICAL: Match live rendering - add images section
    if (data.images && data.images.length > 0) {
        data.images.forEach(img => {
            html += `<img class="step-image" src="data:${img.format};base64,${img.data}" alt="${img.filename}">`;
        });
    }

    div.innerHTML = html;
    container.appendChild(div);
}

function restoreExecutingStep(container, data, iterationId, effectiveStatus = 'completed', stepId = null) {
    const div = document.createElement('div');
    div.className = `step ${effectiveStatus}`;
    if (stepId) div.id = stepId;

    const hasOutput = data.output && data.output.trim().length > 0;

    let html = `
        <div class="step-header">
            <div class="step-icon ${effectiveStatus}">
                ${effectiveStatus === 'running' ? '⟳' : effectiveStatus === 'completed' ? '✓' : effectiveStatus === 'error' ? '✗' : '○'}
            </div>
            <div class="step-content">
                <div class="step-title">${data.title || 'Processing...'}</div>
                ${data.message ? `<div class="step-message">${escapeHtml(data.message)}</div>` : ''}
            </div>
        </div>
    `;

    if (data.error) {
        html += `<div class="step-output" style="background:#fef2f2;border-color:#fca5a5;color:#991b1b;">❌ ${escapeHtml(data.error)}</div>`;
    }

    if (hasOutput) {
        const outputText = Array.isArray(data.output) ? data.output.join('\n') : data.output;
        html += `<div class="step-output">${escapeHtml(outputText)}</div>`;
    }

    // CRITICAL: Match live rendering - add warnings section
    if (data.warnings && data.warnings.length > 0) {
        html += `<div class="step-output" style="background:#fef2f2;border-color:#fca5a5;color:#991b1b;">⚠️ ${escapeHtml(data.warnings.join('\n'))}</div>`;
    }

    // CRITICAL: Match live rendering - add images section
    if (data.images && data.images.length > 0) {
        data.images.forEach(img => {
            html += `<img class="step-image" src="data:${img.format};base64,${img.data}" alt="${img.filename}">`;
        });
    }

    div.innerHTML = html;
    container.appendChild(div);
}

function restoreReviewingStep(container, data, iterationId, effectiveStatus = 'completed', stepId = null) {
    const div = document.createElement('div');
    div.className = `step ${effectiveStatus}`;
    if (stepId) div.id = stepId;

    // CRITICAL: Match live addStepToIteration structure EXACTLY
    div.innerHTML = `
        <div class="step-header">
            <div class="step-icon ${effectiveStatus}">
                ${effectiveStatus === 'running' ? '⟳' : effectiveStatus === 'completed' ? '✓' : effectiveStatus === 'error' ? '✗' : '○'}
            </div>
            <div class="step-content">
                <div class="step-title">${data.title || 'Processing...'}</div>
                ${data.message ? `<div class="step-message">${escapeHtml(data.message)}</div>` : ''}
            </div>
        </div>
    `;
    container.appendChild(div);
}

function restoreFinalInsights(container, data, effectiveStatus = 'completed', stepId = null) {
    const div = document.createElement('div');
    div.className = (effectiveStatus === 'needs_info' || data.status === 'needs_info') ? 'final-insights needs-info' : 'final-insights success';
    if (stepId) div.id = stepId;

    // Unescape newlines from database storage
    const cleanContent = (data.content || '').replace(/\\n/g, '\n');

    // Build sections matching live rendering
    const outputSection = data.executionOutput ? `
        <div class="code-collapsible" style="margin-top: 16px; border-color: #10b981;">
            <div class="code-toggle" onclick="toggleCode(this)" style="background: #d1fae5;">
                <div class="code-toggle-label" style="color: #065f46;">
                    <span>✓</span>
                    <span style="font-weight: 700;">View Actual R Output (Verify Results!)</span>
                </div>
                <span class="code-toggle-icon" style="color: #10b981;">▼</span>
            </div>
            <div class="code-content">
                <div class="step-output" style="max-height: 600px; overflow-y: auto; white-space: pre-wrap; font-size: 12px; line-height: 1.5;">${escapeHtml(data.executionOutput)}</div>
            </div>
        </div>
    ` : '';

    const codeSection = data.fullCode ? `
        <div class="code-collapsible" style="margin-top: 16px;">
            <div class="code-toggle" onclick="toggleCode(this)">
                <div class="code-toggle-label">
                    <span>📝</span>
                    <span>View Complete R Code</span>
                </div>
                <span class="code-toggle-icon">▼</span>
            </div>
            <div class="code-content">
                <div class="code-content-inner">${escapeHtml(data.fullCode)}</div>
            </div>
        </div>
    ` : '';

    const needsInfoClass = data.status === 'needs_info' ? ' needs-info' : '';
    const titleIcon = data.status === 'needs_info' ? '⚠️' : '✅';
    const titleText = data.status === 'needs_info' ? 'Additional Information Needed' : 'Final Results';

    div.innerHTML = `
        <div class="final-insights-title">
            ${titleIcon} ${titleText}
        </div>
        <div class="final-insights-content">
            ${renderMarkdown(cleanContent)}
        </div>
        ${outputSection}
        ${codeSection}
    `;
    container.appendChild(div);
}

function restoreNeedsInfoStep(container, data, effectiveStatus = 'completed', stepId = null) {
    const div = document.createElement('div');
    div.className = 'final-insights needs-info';
    if (stepId) div.id = stepId;

    // Unescape newlines from database storage
    const cleanContent = (data.content || '').replace(/\\n/g, '\n');

    div.innerHTML = `
        <div class="final-insights-title">
            ⚠️ Additional Information Needed
        </div>
        <div class="final-insights-content">
            ${renderMarkdown(cleanContent)}
        </div>
    `;
    container.appendChild(div);
}

function restoreErrorStep(container, data, iterationId, effectiveStatus = 'error', stepId = null) {
    const div = document.createElement('div');
    div.className = `step ${effectiveStatus}`;
    if (stepId) div.id = stepId;

    // CRITICAL: Match live addStepToIteration structure EXACTLY
    div.innerHTML = `
        <div class="step-header">
            <div class="step-icon ${effectiveStatus}">
                ${effectiveStatus === 'running' ? '⟳' : effectiveStatus === 'completed' ? '✓' : effectiveStatus === 'error' ? '✗' : '○'}
            </div>
            <div class="step-content">
                <div class="step-title">${data.title || 'Processing...'}</div>
                ${data.message ? `<div class="step-message">${escapeHtml(data.message)}</div>` : ''}
            </div>
        </div>
    `;
    container.appendChild(div);
}

function restoreOutputsStep(container, data, effectiveStatus = 'completed', stepId = null) {
    if (!data.files || data.files.length === 0) return;

    // CRITICAL FIX: Match exact live rendering structure for cross-chat consistency
    // Use .download-section (live) instead of .output-files-container (restored)
    // Use onclick="downloadFile()" instead of <a href=""> for blob-based downloads
    const div = document.createElement('div');
    div.className = 'download-section';
    if (stepId) div.id = stepId;

    // Match live rendering structure exactly (from chat-biostat.html lines 5229-5260)
    const filesHtml = data.files.map(file => {
        const iconEmoji = getFileIcon(file.type);
        const sizeKB = (file.size / 1024).toFixed(1);
        return `
            <div class="download-file" onclick="downloadFile('${file.download_url}', '${escapeHtml(file.name)}')">
                <div class="file-type-icon ${file.type}">
                    ${iconEmoji}
                </div>
                <div class="download-file-info">
                    <div class="download-file-name" title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</div>
                    <div class="download-file-meta">${file.type} • ${sizeKB} KB</div>
                </div>
                <button class="download-button" onclick="event.stopPropagation(); downloadFile('${file.download_url}', '${escapeHtml(file.name)}')">
                    Download
                </button>
            </div>
        `;
    }).join('');

    div.innerHTML = `
        <div class="download-header">
            <div class="download-icon">📥</div>
            <div class="download-title">${data.title || 'Downloadable Outputs'}</div>
        </div>
        <div class="download-message">${data.message || 'Click any file to download'}</div>
        <div class="download-files">
            ${filesHtml}
        </div>
    `;
    container.appendChild(div);
}

function restoreDomainExpertStep(container, data, iterationId, effectiveStatus = 'completed', stepId = null) {
    const div = document.createElement('div');
    div.className = `step ${effectiveStatus}`;
    if (stepId) div.id = stepId;

    // CRITICAL: Match live addStepToIteration structure EXACTLY
    // Live code only passes: status, title, message, reasoning
    let html = `
        <div class="step-header">
            <div class="step-icon ${effectiveStatus}">
                ${effectiveStatus === 'running' ? '⟳' : effectiveStatus === 'completed' ? '✓' : effectiveStatus === 'error' ? '✗' : '○'}
            </div>
            <div class="step-content">
                <div class="step-title">${data.title || 'Processing...'}</div>
                ${data.message ? `<div class="step-message">${escapeHtml(data.message)}</div>` : ''}
            </div>
        </div>
    `;

    if (data.reasoning) {
        // Unescape newlines from database storage
        const cleanReasoning = data.reasoning.replace(/\\n/g, '\n');

        html += `
            <div class="step-reasoning">
                <div class="reasoning-toggle" onclick="toggleReasoning(this)">
                    <div class="reasoning-toggle-label">
                        <span>🧠</span>
                        <span>Agent Thinking Process</span>
                    </div>
                    <span class="reasoning-toggle-icon">▼</span>
                </div>
                <div class="reasoning-content">
                    <div class="reasoning-content-inner">${renderMarkdown(cleanReasoning)}</div>
                </div>
            </div>
        `;
    }

    div.innerHTML = html;
    container.appendChild(div);
}

function restoreDomainExpertReadyStep(container, data, effectiveStatus = 'completed', stepId = null) {
    const div = document.createElement('div');
    div.className = `step ${effectiveStatus}`;
    if (stepId) div.id = stepId;

    // CRITICAL: Match live addStepToIteration structure EXACTLY
    // Live code only passes: status, title, content
    div.innerHTML = `
        <div class="step-header">
            <div class="step-icon ${effectiveStatus}">
                ${effectiveStatus === 'running' ? '⟳' : effectiveStatus === 'completed' ? '✓' : effectiveStatus === 'error' ? '✗' : '○'}
            </div>
            <div class="step-content">
                <div class="step-title">${data.title || 'Processing...'}</div>
                ${data.content ? `<div class="step-message">${escapeHtml(data.content)}</div>` : ''}
            </div>
        </div>
    `;
    container.appendChild(div);
}

function restoreChatbotIntroCompleteStep(container, data, stepId = null) {
    // CRITICAL FIX: Match exact live rendering structure for cross-chat consistency
    const div = document.createElement('div');
    div.className = 'chatbot-message complete';
    if (stepId) div.id = stepId;

    const introText = data.message || data.fullText || '';
    console.log(`🔄 Restoring intro: ${introText.length} chars`);

    // CRITICAL: Match live structure EXACTLY - must have chatbot-message-row wrapper
    div.innerHTML = `
        <div class="chatbot-message-row">
            <div class="chatbot-icon">💬</div>
            <div class="chatbot-text">
                ${introText ? renderMarkdown(introText) : ''}
            </div>
        </div>
    `;

    container.appendChild(div);
}

function restoreChatbotConclusionCompleteStep(container, data, stepId = null) {
    // CRITICAL FIX: Match exact live rendering structure for cross-chat consistency
    const conclusionDiv = document.createElement('div');
    conclusionDiv.className = 'chatbot-message complete';
    if (stepId) conclusionDiv.id = stepId;

    // Get the conclusion text
    const conclusionText = data.fullText || data.message || data.text || '';
    console.log(`🔄 Restoring conclusion: ${conclusionText.length} chars, ${data.files?.length || 0} files`);

    // CRITICAL: Match live structure EXACTLY - must have chatbot-message-row wrapper
    let html = `
        <div class="chatbot-message-row">
            <div class="chatbot-icon">💬</div>
            <div class="chatbot-text">
                ${conclusionText ? renderMarkdown(conclusionText) : ''}
            </div>
        </div>
    `;

    // Add files section if present (matching live structure from lines 4923-4936)
    if (data.files && data.files.length > 0) {
        html += `
            <div class="chatbot-files">
                <div class="files-title">📥 Downloadable Files</div>
                ${data.files.map(file => `
                    <a href="${file.download_url || file.url}"
                       download="${file.name}"
                       class="file-link"
                       target="_blank">
                        ${getFileIcon(file.type || file.file_type)} ${file.name}
                        <span class="file-size">(${(file.size / 1024).toFixed(1)} KB)</span>
                    </a>
                `).join('')}
            </div>
        `;
    }

    conclusionDiv.innerHTML = html;
    container.appendChild(conclusionDiv);
}

function getFileIcon(type) {
    // CRITICAL: Match live getFileIcon exactly
    const icons = {
        'dataset': '📊',
        'plot': '📈',
        'document': '📄',
        'report': '📋',
        'text': '📝',
        'data': '💾',
        'file': '📎',
        // File extensions
        'png': '🖼️',
        'jpg': '🖼️',
        'jpeg': '🖼️',
        'pdf': '📕',
        'csv': '📊',
        'txt': '📝',
        'html': '🌐',
        'md': '📋',
        'svg': '🎨'
    };
    return icons[type] || icons[type?.toLowerCase()] || '📎';
}

function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// ========================================
// Helper Functions
// ========================================

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    // CRITICAL: Match live - convert newlines to <br> tags
    return div.innerHTML.replace(/\n/g, '<br>');
}

function toggleReasoning(button) {
    const content = button.nextElementSibling;
    const icon = button.querySelector('.reasoning-toggle-icon');

    if (content.classList.contains('expanded')) {
        content.classList.remove('expanded');
        icon.classList.remove('expanded');
    } else {
        content.classList.add('expanded');
        icon.classList.add('expanded');
    }
}

function toggleCode(button) {
    const content = button.nextElementSibling;
    const icon = button.querySelector('.code-toggle-icon');

    if (content.classList.contains('expanded')) {
        content.classList.remove('expanded');
        icon.classList.remove('expanded');
    } else {
        content.classList.add('expanded');
        icon.classList.add('expanded');
    }
}

function toggleCodeView(containerId) {
    const codeSection = document.getElementById(`${containerId}-code`);
    if (codeSection) {
        codeSection.style.display = codeSection.style.display === 'none' ? 'block' : 'none';
    }
}

function toggleOutputView(containerId) {
    const outputSection = document.getElementById(`${containerId}-output`);
    if (outputSection) {
        outputSection.style.display = outputSection.style.display === 'none' ? 'block' : 'none';
    }
}

function toggleCodeBlock(codeId) {
    const codeBlock = document.getElementById(codeId);
    // Get the button that was clicked - it's the element that triggered the onclick
    const button = window.event ? window.event.target : document.activeElement;

    if (codeBlock) {
        const isVisible = codeBlock.style.display !== 'none';
        codeBlock.style.display = isVisible ? 'none' : 'block';
        if (button && button.tagName === 'BUTTON') {
            button.textContent = isVisible ? '📄 Show Code ▼' : '📄 Hide Code ▲';
        }
    }
}

function restoreReasoningStep(container, data, iterationId, effectiveStatus = 'completed', stepId = null) {
    const div = document.createElement('div');
    div.className = `step ${effectiveStatus}`;
    if (stepId) div.id = stepId;

    // CRITICAL: Match live addStepToIteration structure EXACTLY
    let html = `
        <div class="step-header">
            <div class="step-icon ${effectiveStatus}">
                ${effectiveStatus === 'running' ? '⟳' : effectiveStatus === 'completed' ? '✓' : effectiveStatus === 'error' ? '✗' : '○'}
            </div>
            <div class="step-content">
                <div class="step-title">${data.title || 'Processing...'}</div>
                ${data.message ? `<div class="step-message">${escapeHtml(data.message)}</div>` : ''}
            </div>
        </div>
    `;

    // Add reasoning dropdown if there's reasoning content
    if (data.reasoning) {
        const cleanReasoning = data.reasoning.replace(/\\n/g, '\n');
        html += `
            <div class="step-reasoning">
                <div class="reasoning-toggle" onclick="toggleReasoning(this)">
                    <div class="reasoning-toggle-label">
                        <span>🧠</span>
                        <span>Agent Thinking Process</span>
                    </div>
                    <span class="reasoning-toggle-icon">▼</span>
                </div>
                <div class="reasoning-content">
                    <div class="reasoning-content-inner">${renderMarkdown(cleanReasoning)}</div>
                </div>
            </div>
        `;
    }

    div.innerHTML = html;
    container.appendChild(div);
}

function restoreGenericStep(container, data, effectiveStatus = 'completed', stepId = null) {
    // Generic step restoration matching addStepToIteration exactly
    const div = document.createElement('div');
    div.className = `step ${effectiveStatus}`;
    if (stepId) div.id = stepId;

    let html = `
        <div class="step-header">
            <div class="step-icon ${effectiveStatus}">
                ${effectiveStatus === 'running' ? '⟳' : effectiveStatus === 'completed' ? '✓' : effectiveStatus === 'error' ? '✗' : '○'}
            </div>
            <div class="step-content">
                <div class="step-title">${data.title || 'Processing...'}</div>
                ${data.message ? `<div class="step-message">${escapeHtml(data.message)}</div>` : ''}
            </div>
        </div>
    `;

    // Add reasoning dropdown if present
    if (data.reasoning) {
        const cleanReasoning = data.reasoning.replace(/\\n/g, '\n');
        html += `
            <div class="step-reasoning">
                <div class="reasoning-toggle" onclick="toggleReasoning(this)">
                    <div class="reasoning-toggle-label">
                        <span>🧠</span>
                        <span>Agent Thinking Process</span>
                    </div>
                    <span class="reasoning-toggle-icon">▼</span>
                </div>
                <div class="reasoning-content">
                    <div class="reasoning-content-inner">${renderMarkdown(cleanReasoning)}</div>
                </div>
            </div>
        `;
    }

    // Add code section if present
    if (data.code) {
        const codeId = `code-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        html += `
            <button class="toggle-code-btn" onclick="toggleCodeBlock('${codeId}')">
                📄 Show Code ▼
            </button>
            <div id="${codeId}" class="code-block-container" style="display: none;">
                <pre><code class="language-r">${escapeHtml(data.code)}</code></pre>
            </div>
        `;
    }

    // Add output section if present
    if (data.output) {
        const outputText = Array.isArray(data.output) ? data.output.join('\n') : data.output;
        html += `<div class="step-output">${escapeHtml(outputText)}</div>`;
    }

    // Add warnings section if present
    if (data.warnings && data.warnings.length > 0) {
        html += `<div class="step-output" style="background:#fef2f2;border-color:#fca5a5;color:#991b1b;">⚠️ ${escapeHtml(data.warnings.join('\n'))}</div>`;
    }

    // Add images section if present
    if (data.images && data.images.length > 0) {
        data.images.forEach(img => {
            html += `<img class="step-image" src="data:${img.format};base64,${img.data}" alt="${img.filename}">`;
        });
    }

    // Add content for steps like consultation/clarification
    if (data.content && !data.message) {
        html += `<div class="step-message">${escapeHtml(data.content)}</div>`;
    }

    div.innerHTML = html;
    container.appendChild(div);
}

function restoreClarificationStep(container, data, effectiveStatus = 'completed', stepId = null) {
    const div = document.createElement('div');
    div.className = `step ${effectiveStatus}`;
    if (stepId) div.id = stepId;

    // Use styled final-insights box matching the live rendering
    const clarificationContent = data.content || data.reasoning || data.message || 'Please clarify your request so I can assist you better.';
    div.innerHTML = `
        <div class="final-insights clarification">
            <div class="final-insights-title">
                ❓ Clarification Needed
            </div>
            <div class="final-insights-content">${renderMarkdown(clarificationContent)}</div>
        </div>
    `;
    container.appendChild(div);
}

// Export for use in main HTML
window.restoreWorkflowSteps = restoreWorkflowSteps;
window.toggleCodeBlock = toggleCodeBlock;
window.toggleReasoning = toggleReasoning;
window.toggleCode = toggleCode;
window.toggleCodeView = toggleCodeView;
window.toggleOutputView = toggleOutputView;
