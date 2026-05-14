/**
 * ANALYTICS INTEGRATION
 * Connects UserAnalytics module with Power Agent application
 */

(function() {
    // Global analytics instance
    window.powerAgentAnalytics = null;

    // Store current analysis request ID for completion tracking
    window.currentAnalysisRequestId = null;

    /**
     * Initialize analytics when Supabase is ready
     */
    window.initializePowerAgentAnalytics = async function(supabaseClient, sessionId) {
        try {
            console.log('🔍 Initializing Power Agent Analytics...');

            // Create analytics instance
            window.powerAgentAnalytics = new window.UserAnalytics(supabaseClient);
            window.powerAgentAnalytics.sessionId = sessionId;

            console.log('✅ Power Agent Analytics initialized');
            console.log('   Session ID:', sessionId);

        } catch (error) {
            console.error('❌ Analytics initialization failed:', error);
        }
    };

    /**
     * Track message sent
     */
    window.trackMessageSent = function(message, templateUsed = null, agentMode = 'single') {
        if (!window.powerAgentAnalytics) return;

        // Track the interaction
        window.powerAgentAnalytics.trackInteraction(
            'message_send',
            'chat',
            agentMode,
            message.substring(0, 100), // First 100 chars
            {
                message_length: message.length,
                template_used: templateUsed,
                agent_mode: agentMode
            }
        );

        // Track as analysis request
        window.powerAgentAnalytics.trackAnalysisRequest(
            message,
            templateUsed,
            agentMode
        ).then(requestId => {
            window.currentAnalysisRequestId = requestId;
            console.log('📊 Analysis request tracked:', requestId);
        });
    };

    /**
     * Track analysis completion
     */
    window.trackAnalysisComplete = function(success = true, metadata = {}) {
        if (!window.powerAgentAnalytics || !window.currentAnalysisRequestId) return;

        const status = success ? 'completed' : 'failed';

        window.powerAgentAnalytics.completeAnalysisRequest(
            window.currentAnalysisRequestId,
            status,
            metadata
        );

        console.log('✅ Analysis completion tracked:', status);
        window.currentAnalysisRequestId = null;
    };

    /**
     * Track template usage
     */
    window.trackTemplateUsage = function(templateName) {
        if (!window.powerAgentAnalytics) return;

        window.powerAgentAnalytics.trackTemplateUsage(templateName);

        // Also track as interaction
        window.powerAgentAnalytics.trackInteraction(
            'template_select',
            'templates',
            templateName,
            '',
            { template_name: templateName }
        );

        console.log('📋 Template usage tracked:', templateName);
    };

    /**
     * Track file download
     */
    window.trackFileDownload = function(fileName, fileType, fileUrl = null, fileSize = null) {
        if (!window.powerAgentAnalytics) return;

        window.powerAgentAnalytics.trackFileInteraction(
            fileName,
            fileType,
            'download',
            fileSize,
            fileUrl,
            window.currentAnalysisRequestId
        );

        console.log('📥 File download tracked:', fileName);
    };

    /**
     * Track file upload
     */
    window.trackFileUpload = function(fileName, fileType, fileSize = null) {
        if (!window.powerAgentAnalytics) return;

        window.powerAgentAnalytics.trackFileInteraction(
            fileName,
            fileType,
            'upload',
            fileSize,
            null,
            null
        );

        console.log('📤 File upload tracked:', fileName);
    };

    /**
     * Track page/tab change
     */
    window.trackPageView = function(pageName) {
        if (!window.powerAgentAnalytics) return;

        window.powerAgentAnalytics.trackInteraction(
            'page_view',
            'navigation',
            pageName,
            window.location.href
        );
    };

    /**
     * Track button click
     */
    window.trackButtonClick = function(buttonName, category = 'interaction') {
        if (!window.powerAgentAnalytics) return;

        window.powerAgentAnalytics.trackInteraction(
            'click',
            category,
            buttonName
        );
    };

    /**
     * Track agent mode change
     */
    window.trackAgentModeChange = function(newMode) {
        if (!window.powerAgentAnalytics) return;

        window.powerAgentAnalytics.trackInteraction(
            'agent_mode_change',
            'settings',
            newMode,
            '',
            { agent_mode: newMode }
        );

        console.log('🤖 Agent mode change tracked:', newMode);
    };

    /**
     * Track error
     */
    window.trackError = function(errorType, errorMessage, context = {}) {
        if (!window.powerAgentAnalytics) return;

        window.powerAgentAnalytics.trackInteraction(
            'error',
            'system',
            errorType,
            errorMessage,
            { ...context, error_message: errorMessage }
        );

        console.log('⚠️ Error tracked:', errorType);
    };

    /**
     * Auto-track certain elements on page
     */
    function setupAutoTracking() {
        // Wait for DOM to be ready
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', setupAutoTracking);
            return;
        }

        // Track tab changes
        const tabs = document.querySelectorAll('[role="tab"], .tab');
        tabs.forEach(tab => {
            tab.addEventListener('click', function() {
                const tabName = this.textContent || this.getAttribute('data-tab') || 'unknown';
                window.trackPageView(tabName);
            });
        });

        // Track all links
        document.addEventListener('click', function(e) {
            const link = e.target.closest('a');
            if (link) {
                const href = link.getAttribute('href');
                if (href && window.powerAgentAnalytics) {
                    window.powerAgentAnalytics.trackInteraction(
                        'link_click',
                        'navigation',
                        href
                    );
                }
            }
        });

        // Track file inputs
        const fileInputs = document.querySelectorAll('input[type="file"]');
        fileInputs.forEach(input => {
            input.addEventListener('change', function(e) {
                if (e.target.files.length > 0) {
                    const file = e.target.files[0];
                    const fileType = file.name.split('.').pop();
                    window.trackFileUpload(file.name, fileType, file.size);
                }
            });
        });

        console.log('✅ Auto-tracking set up');
    }

    // Set up auto-tracking when script loads
    setupAutoTracking();

    console.log('📊 Analytics integration module loaded');

})();
