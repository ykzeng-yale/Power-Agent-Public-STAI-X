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
            const iterationId = `iteration-${currentAgentMsgId}-${iterNum}`;

            // Check if iteration container already exists
            let iterContainer = document.getElementById(iterationId);
            if (!iterContainer) {
                // All iterations should be expanded when restoring to match live experience
                iterContainer = document.createElement('div');
                iterContainer.id = iterationId;
                iterContainer.className = 'iteration-container'; // No 'collapsed' - show all iterations
                iterContainer.innerHTML = `
                    <div class="iteration-header" onclick="toggleIteration('${iterationId}')">
                        <span class="iteration-badge">📊 Iteration ${iterNum}</span>
                        <span class="iteration-toggle">▼</span>
                    </div>
                    <div class="iteration-content"></div>
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
    let { step_type, step_data, status } = step;

    // Parse step_data if it's a string
    if (typeof step_data === 'string') {
        try {
            step_data = JSON.parse(step_data);
        } catch (e) {
            console.error(`Failed to parse step_data for ${step_type}:`, e);
        }
    }

    switch (step_type) {
        case 'pi_routing':
            restorePIRoutingStep(container, step_data);
            break;

        case 'pi_answer':
            restorePIAnswerStep(container, step_data);
            break;

        case 'thinking':
            restoreThinkingStep(container, step_data, iterationId);
            break;

        case 'code':
            restoreCodeStep(container, step_data, iterationId);
            break;

        case 'executing':
            restoreExecutingStep(container, step_data, iterationId);
            break;

        case 'reviewing':
            restoreReviewingStep(container, step_data, iterationId);
            break;

        case 'insights':
            restoreFinalInsights(container, step_data);
            break;

        case 'needs_info':
            restoreNeedsInfoStep(container, step_data);
            break;

        case 'error':
            restoreErrorStep(container, step_data, iterationId);
            break;

        case 'reasoning':
            restoreReasoningStep(container, step_data, iterationId);
            break;

        case 'clarification':
            restoreClarificationStep(container, step_data);
            break;

        case 'init':
            // Init marker - no UI needed
            break;

        case 'summary':
            // Summary step - rendered as part of insights
            break;

        case 'outputs':
            restoreOutputsStep(container, step_data);
            break;

        case 'domain_expert_analysis':
            restoreDomainExpertStep(container, step_data, iterationId);
            break;

        case 'domain_expert_ready':
            restoreDomainExpertReadyStep(container, step_data);
            break;

        case 'chatbot_intro_start':
            // Skip start marker - we only need the complete version
            break;

        case 'chatbot_intro_stream':
            // Skip intermediate streaming - we only need the complete version
            break;

        case 'chatbot_intro_complete':
            restoreChatbotIntroCompleteStep(container, step_data);
            break;

        case 'chatbot_conclusion_start':
            // Skip start marker - we only need the complete version
            break;

        case 'chatbot_conclusion_stream':
            // Skip intermediate streaming - we only need the complete version
            break;

        case 'chatbot_conclusion_complete':
            // CRITICAL FIX: Only restore the complete version to avoid duplicates
            restoreChatbotConclusionCompleteStep(container, step_data);
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

function restorePIRoutingStep(container, data) {
    const div = document.createElement('div');
    div.className = 'step completed';

    // Unescape newlines in reasoning
    const cleanReasoning = data.reasoning ? data.reasoning.replace(/\\n/g, '\n') : '';

    div.innerHTML = `
        <div class="step-header">
            <div class="step-icon completed">✓</div>
            <div class="step-content">
                <div class="step-title">🧠 PI Agent: ${data.title || 'Routing Decision'}</div>
                ${data.decision ? `<div class="step-message">Decision: ${escapeHtml(data.decision)}</div>` : ''}
            </div>
        </div>
        ${cleanReasoning ? `
            <div class="step-message" style="margin-top: 8px; padding: 12px; background: #fef3c7; border-left: 3px solid #fbbf24; border-radius: 4px;">
                <strong style="color: #92400e;">Reasoning:</strong> ${renderMarkdown(cleanReasoning)}
            </div>
        ` : ''}
        ${data.confidence ? `
            <div class="step-message" style="margin-top: 8px;">
                <strong>Confidence:</strong> ${(data.confidence * 100).toFixed(0)}%
            </div>
        ` : ''}
    `;
    container.appendChild(div);
}

function restorePIAnswerStep(container, data) {
    const div = document.createElement('div');
    div.className = 'step completed';

    // Unescape newlines from database storage
    const cleanContent = (data.content || '').replace(/\\n/g, '\n');

    div.innerHTML = `
        <div class="step-header">
            <div class="step-icon completed">✓</div>
            <div class="step-content">
                <div class="step-title">🧠 PI Agent: Direct Answer</div>
            </div>
        </div>
        <div class="step-message" style="margin-top: 12px;">
            ${renderMarkdown(cleanContent)}
        </div>
    `;
    container.appendChild(div);
}

function restoreThinkingStep(container, data, iterationId) {
    const div = document.createElement('div');
    div.className = `step ${data.status || 'completed'}`;

    let html = `
        <div class="step-header">
            <div class="step-icon ${data.status || 'completed'}">
                ${data.status === 'running' ? '⟳' : data.status === 'completed' ? '✓' : '○'}
            </div>
            <div class="step-content">
                <div class="step-title">${data.title || '🤔 Agent Thinking'}</div>
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
                    <span class="reasoning-toggle-icon">▶</span>
                </div>
                <div class="reasoning-content" style="display: none;">
                    <div class="reasoning-content-inner">${renderMarkdown(cleanReasoning)}</div>
                </div>
            </div>
        `;
    }

    div.innerHTML = html;
    container.appendChild(div);
}

function restoreCodeStep(container, data, iterationId) {
    const div = document.createElement('div');
    div.className = `step ${data.status || 'completed'}`;

    const codeId = `code-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    let html = `
        <div class="step-header">
            <div class="step-icon completed">✓</div>
            <div class="step-content">
                <div class="step-title">${data.title || '📝 Code Generation'}</div>
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

    div.innerHTML = html;
    container.appendChild(div);
}

function restoreExecutingStep(container, data, iterationId) {
    const div = document.createElement('div');
    div.className = `step ${data.status || 'completed'}`;

    const hasOutput = data.output && data.output.trim().length > 0;

    let html = `
        <div class="step-header">
            <div class="step-icon ${data.status || 'completed'}">
                ${data.status === 'running' ? '⟳' : data.status === 'completed' ? '✓' : data.status === 'error' ? '✗' : '○'}
            </div>
            <div class="step-content">
                <div class="step-title">${data.title || '⚡ Executing R Code'}</div>
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

    div.innerHTML = html;
    container.appendChild(div);
}

function restoreReviewingStep(container, data, iterationId) {
    const div = document.createElement('div');
    div.className = `step ${data.status || 'completed'}`;

    div.innerHTML = `
        <div class="step-header">
            <div class="step-icon ${data.status || 'completed'}">
                ${data.status === 'running' ? '⟳' : data.status === 'completed' ? '✓' : '○'}
            </div>
            <div class="step-content">
                <div class="step-title">${data.title || '🔍 Agent Reviewing Results'}</div>
                ${data.message ? `<div class="step-message">${escapeHtml(data.message)}</div>` : ''}
            </div>
        </div>
    `;
    container.appendChild(div);
}

function restoreFinalInsights(container, data) {
    const div = document.createElement('div');
    div.className = data.status === 'needs_info' ? 'final-insights needs-info' : 'final-insights success';

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
    const titleText = data.status === 'needs_info' ? 'Additional Information Needed' : 'Final Biostatistical Insights';

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

function restoreNeedsInfoStep(container, data) {
    const div = document.createElement('div');
    div.className = 'final-insights needs-info';

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

function restoreErrorStep(container, data, iterationId) {
    const div = document.createElement('div');
    div.className = 'step-container error';
    div.innerHTML = `
        <div class="step-header">
            <span class="step-badge error-badge">${data.title || '❌ Error'}</span>
            <span class="step-status error">✗</span>
        </div>
        <div class="error-message">
            ${escapeHtml(data.message || data.error || 'Unknown error')}
        </div>
    `;
    container.appendChild(div);
}

function restoreOutputsStep(container, data) {
    if (!data.files || data.files.length === 0) return;

    // CRITICAL FIX: Match exact live rendering structure for cross-chat consistency
    // Use .download-section (live) instead of .output-files-container (restored)
    // Use onclick="downloadFile()" instead of <a href=""> for blob-based downloads
    const div = document.createElement('div');
    div.className = 'download-section';

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

function restoreDomainExpertStep(container, data, iterationId) {
    const div = document.createElement('div');
    div.className = `step ${data.status || 'completed'}`;

    const modeIcon = data.mode === 'needs_info' ? '⚠️' : '✅';
    const modeText = data.mode === 'needs_info' ? 'Need More Information' :
                     data.mode === 'ready' ? 'Query Ready' : 'Analysis Complete';

    let html = `
        <div class="step-header">
            <div class="step-icon ${data.status || 'completed'}">
                ${data.status === 'running' ? '⟳' : data.status === 'completed' ? '✓' : '○'}
            </div>
            <div class="step-content">
                <div class="step-title">${data.title || '🧠 Domain Expert Analysis'}</div>
                ${data.message ? `<div class="step-message">${escapeHtml(data.message)}</div>` : ''}
                ${data.mode ? `<div class="step-message"><strong>${modeIcon} ${modeText}</strong></div>` : ''}
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
                        <span>Expert Analysis</span>
                    </div>
                    <span class="reasoning-toggle-icon">▼</span>
                </div>
                <div class="reasoning-content">
                    <div class="reasoning-content-inner">${renderMarkdown(cleanReasoning)}</div>
                </div>
            </div>
        `;
    }

    if (data.webSearchUsed) {
        html += `
            <div class="step-message" style="margin-top: 8px; padding: 8px; background: #e0f2fe; border-left: 3px solid #0284c7; border-radius: 4px;">
                🔍 Web search was used to augment domain knowledge
            </div>
        `;
    }

    div.innerHTML = html;
    container.appendChild(div);
}

function restoreDomainExpertReadyStep(container, data) {
    const div = document.createElement('div');
    div.className = `step ${data.status || 'completed'}`;

    let html = `
        <div class="step-header">
            <div class="step-icon ${data.status || 'completed'}">✓</div>
            <div class="step-content">
                <div class="step-title">${data.title || '✅ Domain Expert: Ready for Analysis'}</div>
                ${data.content ? `<div class="step-message">${escapeHtml(data.content)}</div>` : ''}
            </div>
        </div>
    `;

    if (data.confirmed_parameters && Object.keys(data.confirmed_parameters).length > 0) {
        const params = Object.entries(data.confirmed_parameters)
            .map(([key, value]) => `<li><strong>${key}:</strong> ${escapeHtml(String(value))}</li>`)
            .join('');

        html += `
            <div class="step-message" style="margin-top: 8px; padding: 12px; background: #f0f9ff; border-left: 3px solid #0284c7; border-radius: 4px;">
                <strong>✓ Confirmed Parameters:</strong>
                <ul style="margin: 4px 0 0 20px; padding: 0;">
                    ${params}
                </ul>
            </div>
        `;
    }

    div.innerHTML = html;
    container.appendChild(div);
}

function restoreChatbotIntroCompleteStep(container, data) {
    // CRITICAL FIX: Match exact live rendering structure for cross-chat consistency
    // Use .chatbot-message.complete instead of .step.chatbot-intro
    const div = document.createElement('div');
    div.className = 'chatbot-message complete';

    const introText = data.message || data.fullText || '';
    console.log(`🔄 Restoring intro: ${introText.length} chars`);

    // Match live rendering structure exactly (from chat-biostat.html lines 4804-4842)
    div.innerHTML = `
        <div class="chatbot-icon">💬</div>
        <div class="chatbot-text">
            ${introText ? renderMarkdown(introText) : ''}
        </div>
    `;

    container.appendChild(div);
}

function restoreChatbotConclusionCompleteStep(container, data) {
    // CRITICAL FIX: Match exact live rendering structure for cross-chat consistency
    // Use .chatbot-message.complete instead of .step.chatbot-conclusion
    const conclusionDiv = document.createElement('div');
    conclusionDiv.className = 'chatbot-message complete';

    // Get the conclusion text
    const conclusionText = data.fullText || data.message || data.text || '';
    console.log(`🔄 Restoring conclusion: ${conclusionText.length} chars, ${data.files?.length || 0} files`);

    // Match live rendering structure exactly (from chat-biostat.html lines 4845-4898)
    conclusionDiv.innerHTML = `
        <div class="chatbot-icon">💬</div>
        <div class="chatbot-text">
            ${conclusionText ? renderMarkdown(conclusionText) : ''}
        </div>
    `;

    container.appendChild(conclusionDiv);

    // NOTE: Files are rendered separately by the "Downloadable Outputs" section
    // Removed duplicate file rendering here to avoid showing files twice
}

function getFileIcon(type) {
    const icons = {
        'plot': '📊',
        'dataset': '📋',
        'report': '📄',
        'document': '📃',
        'text': '📝',
        'data': '💾'
    };
    return icons[type] || '📁';
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
    return div.innerHTML;
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

function restoreReasoningStep(container, data, iterationId) {
    const div = document.createElement('div');
    div.className = `step ${data.status || 'completed'}`;

    let html = `
        <div class="step-header">
            <div class="step-icon ${data.status || 'completed'}">
                ${data.status === 'running' ? '⟳' : data.status === 'completed' ? '✓' : '○'}
            </div>
            <div class="step-content">
                <div class="step-title">${data.title || '🧠 Agent Reasoning'}</div>
            </div>
        </div>
    `;

    if (data.message) {
        // Unescape newlines from database storage
        const cleanMessage = data.message.replace(/\\n/g, '\n');

        html += `
            <div class="step-reasoning">
                <div class="reasoning-toggle" onclick="toggleReasoning(this)">
                    <div class="reasoning-toggle-label">
                        <span>🧠</span>
                        <span>Agent Reasoning</span>
                    </div>
                    <span class="reasoning-toggle-icon">▶</span>
                </div>
                <div class="reasoning-content" style="display: none;">
                    <div class="reasoning-content-inner">${renderMarkdown(cleanMessage)}</div>
                </div>
            </div>
        `;
    }

    div.innerHTML = html;
    container.appendChild(div);
}

function restoreClarificationStep(container, data) {
    const div = document.createElement('div');
    div.className = 'step completed';

    // Unescape newlines from database storage
    const cleanContent = (data.content || data.message || '').replace(/\\n/g, '\n');

    // CRITICAL FIX: Render clarification prominently like consultation/needs_info
    div.innerHTML = `
        <div class="final-insights clarification">
            <div class="final-insights-title">
                ❓ Clarification Needed
            </div>
            <div class="final-insights-content">${renderMarkdown(cleanContent)}</div>
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
