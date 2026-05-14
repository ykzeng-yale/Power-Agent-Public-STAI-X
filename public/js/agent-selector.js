/**
 * Agent Selector Component
 * Shared component for switching between single and multi-agent modes
 */

class AgentSelector {
    constructor() {
        this.currentMode = localStorage.getItem('agentMode') || 'single';
        this.initialized = false;
    }

    /**
     * Initialize the agent selector in the page header
     */
    init(containerId = 'agentSelectorContainer') {
        if (this.initialized) return;

        const container = document.getElementById(containerId);
        if (!container) {
            console.warn('Agent selector container not found');
            return;
        }

        // Create selector HTML
        container.innerHTML = this.createSelectorHTML();

        // Set initial value
        const selector = container.querySelector('#agentModeSelect');
        if (selector) {
            selector.value = this.currentMode;

            // Add change event listener
            selector.addEventListener('change', (e) => this.handleModeChange(e.target.value));
        }

        // Add tooltip
        this.addTooltips();

        this.initialized = true;
    }

    /**
     * Create the selector HTML
     */
    createSelectorHTML() {
        return `
            <div class="agent-selector-wrapper">
                <div class="agent-selector-label">Agent Mode:</div>
                <select id="agentModeSelect" class="agent-selector">
                    <option value="single">🤖 Single Agent</option>
                    <option value="multi">🏥 Multi-Agent System</option>
                </select>
                <div class="agent-selector-info" id="agentInfoIcon">
                    ℹ️
                    <div class="agent-selector-tooltip" id="agentTooltip">
                        <div class="tooltip-content">
                            <strong>Single Agent:</strong> General-purpose biostatistics analysis<br><br>
                            <strong>Multi-Agent:</strong> Clinical trial design with collaborative agents
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * Handle mode change
     */
    handleModeChange(newMode) {
        if (newMode === this.currentMode) return;

        // Show confirmation if there's active work
        if (this.hasActiveWork()) {
            const confirmed = confirm(
                'Switching agent modes will start a new session. ' +
                'Your current work will be saved. Continue?'
            );

            if (!confirmed) {
                // Reset selector to current mode
                document.getElementById('agentModeSelect').value = this.currentMode;
                return;
            }
        }

        // Save preference
        localStorage.setItem('agentMode', newMode);
        localStorage.setItem('lastAgentSelection', new Date().toISOString());

        // Show loading indicator
        this.showSwitchingIndicator();

        // Redirect to appropriate page
        setTimeout(() => {
            if (newMode === 'single') {
                window.location.href = '/chat-biostat.html';
            } else if (newMode === 'multi') {
                window.location.href = '/chat-multi-agent.html';
            }
        }, 500);
    }

    /**
     * Check if there's active work in progress
     */
    hasActiveWork() {
        // Check if there are messages in the chat
        const messages = document.querySelectorAll('.message');
        if (messages && messages.length > 1) { // More than just welcome message
            return true;
        }

        // Check if analysis is running
        const runningAnalysis = document.querySelector('.iteration-container.active');
        if (runningAnalysis) {
            return true;
        }

        return false;
    }

    /**
     * Show switching indicator
     */
    showSwitchingIndicator() {
        // Create overlay
        const overlay = document.createElement('div');
        overlay.className = 'agent-switching-overlay';
        overlay.innerHTML = `
            <div class="switching-content">
                <div class="switching-spinner"></div>
                <div class="switching-text">Switching agent mode...</div>
            </div>
        `;
        document.body.appendChild(overlay);

        // Add active class for animation
        setTimeout(() => overlay.classList.add('active'), 10);
    }

    /**
     * Add tooltip interactions
     */
    addTooltips() {
        const infoIcon = document.getElementById('agentInfoIcon');
        const tooltip = document.getElementById('agentTooltip');

        if (infoIcon && tooltip) {
            // Show on hover
            infoIcon.addEventListener('mouseenter', () => {
                tooltip.style.display = 'block';
            });

            infoIcon.addEventListener('mouseleave', () => {
                tooltip.style.display = 'none';
            });

            // Show on click for mobile
            infoIcon.addEventListener('click', (e) => {
                e.stopPropagation();
                tooltip.style.display = tooltip.style.display === 'block' ? 'none' : 'block';
            });

            // Hide tooltip on document click
            document.addEventListener('click', () => {
                tooltip.style.display = 'none';
            });
        }
    }

    /**
     * Get current mode
     */
    getCurrentMode() {
        return this.currentMode;
    }

    /**
     * Update visual indicator based on current page
     */
    updatePageIndicator() {
        const currentPage = window.location.pathname;
        const selector = document.getElementById('agentModeSelect');

        if (!selector) return;

        if (currentPage.includes('chat-biostat.html')) {
            selector.value = 'single';
            this.currentMode = 'single';
        } else if (currentPage.includes('chat-multi-agent.html')) {
            selector.value = 'multi';
            this.currentMode = 'multi';
        }
    }
}

// Styles for the agent selector
const agentSelectorStyles = `
    <style>
    .agent-selector-wrapper {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 8px 16px;
        background: rgba(255, 255, 255, 0.1);
        border-radius: 12px;
        backdrop-filter: blur(10px);
    }

    .agent-selector-label {
        font-size: 14px;
        font-weight: 600;
        color: rgba(255, 255, 255, 0.9);
    }

    .agent-selector {
        padding: 6px 12px;
        border-radius: 8px;
        border: 1px solid rgba(255, 255, 255, 0.2);
        background: rgba(255, 255, 255, 0.95);
        color: #1f2937;
        font-size: 14px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.3s ease;
        min-width: 180px;
    }

    .agent-selector:hover {
        border-color: #8b5cf6;
        box-shadow: 0 2px 8px rgba(139, 92, 246, 0.2);
    }

    .agent-selector:focus {
        outline: none;
        border-color: #8b5cf6;
        box-shadow: 0 0 0 3px rgba(139, 92, 246, 0.1);
    }

    .agent-selector-info {
        position: relative;
        cursor: help;
        font-size: 16px;
        opacity: 0.8;
        transition: opacity 0.2s;
    }

    .agent-selector-info:hover {
        opacity: 1;
    }

    .agent-selector-tooltip {
        display: none;
        position: absolute;
        top: 100%;
        left: 50%;
        transform: translateX(-50%);
        margin-top: 8px;
        padding: 12px;
        background: white;
        color: #1f2937;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        font-size: 13px;
        line-height: 1.5;
        width: 280px;
        z-index: 1000;
    }

    .agent-selector-tooltip::before {
        content: '';
        position: absolute;
        top: -6px;
        left: 50%;
        transform: translateX(-50%);
        width: 12px;
        height: 12px;
        background: white;
        transform: translateX(-50%) rotate(45deg);
    }

    .tooltip-content strong {
        color: #8b5cf6;
        font-weight: 600;
    }

    /* Switching overlay */
    .agent-switching-overlay {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.8);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 9999;
        opacity: 0;
        transition: opacity 0.3s ease;
    }

    .agent-switching-overlay.active {
        opacity: 1;
    }

    .switching-content {
        text-align: center;
        color: white;
    }

    .switching-spinner {
        width: 50px;
        height: 50px;
        border: 4px solid rgba(255, 255, 255, 0.3);
        border-top: 4px solid white;
        border-radius: 50%;
        animation: spin 1s linear infinite;
        margin: 0 auto 20px;
    }

    @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
    }

    .switching-text {
        font-size: 16px;
        font-weight: 500;
    }

    /* Mobile responsiveness */
    @media (max-width: 768px) {
        .agent-selector-wrapper {
            padding: 6px 12px;
        }

        .agent-selector-label {
            display: none;
        }

        .agent-selector {
            min-width: 150px;
            font-size: 13px;
        }
    }
    </style>
`;

// Auto-inject styles when script loads
if (typeof document !== 'undefined' && !document.getElementById('agentSelectorStyles')) {
    const styleElement = document.createElement('div');
    styleElement.id = 'agentSelectorStyles';
    styleElement.innerHTML = agentSelectorStyles;
    document.head.appendChild(styleElement.firstElementChild);
}

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
    module.exports = AgentSelector;
} else {
    window.AgentSelector = AgentSelector;
}

// Auto-initialize on DOM ready if container exists
if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', () => {
        const selector = new AgentSelector();
        if (document.getElementById('agentSelectorContainer')) {
            selector.init();
            selector.updatePageIndicator();
        }
    });
}