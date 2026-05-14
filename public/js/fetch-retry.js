/**
 * Fetch with Retry Logic
 * Provides automatic retry with exponential backoff for network failures
 */

class FetchRetry {
    constructor(options = {}) {
        this.maxRetries = options.maxRetries || 3;
        this.initialDelay = options.initialDelay || 1000;
        this.maxDelay = options.maxDelay || 30000;
        this.backoffMultiplier = options.backoffMultiplier || 2;
        this.retryOnStatus = options.retryOnStatus || [429, 500, 502, 503, 504];
        this.onRetry = options.onRetry || (() => {});
    }

    async fetch(url, options = {}, retryOptions = {}) {
        const maxRetries = retryOptions.maxRetries ?? this.maxRetries;
        const retryOnStatus = retryOptions.retryOnStatus ?? this.retryOnStatus;

        let lastError;
        let delay = this.initialDelay;

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                const response = await fetch(url, options);

                // Check if we should retry based on status code
                if (retryOnStatus.includes(response.status) && attempt < maxRetries) {
                    lastError = new Error(`HTTP ${response.status}: ${response.statusText}`);
                    await this.handleRetry(attempt, delay, lastError, url);
                    delay = Math.min(delay * this.backoffMultiplier, this.maxDelay);
                    continue;
                }

                return response;

            } catch (error) {
                lastError = error;

                // Check if it's a network error
                if (this.isNetworkError(error) && attempt < maxRetries) {
                    await this.handleRetry(attempt, delay, error, url);
                    delay = Math.min(delay * this.backoffMultiplier, this.maxDelay);
                    continue;
                }

                throw error;
            }
        }

        // All retries failed
        throw new Error(`Failed after ${maxRetries} retries: ${lastError.message}`);
    }

    isNetworkError(error) {
        return error instanceof TypeError && (
            error.message.includes('network') ||
            error.message.includes('Failed to fetch') ||
            error.message.includes('ECONNREFUSED') ||
            error.message.includes('ETIMEDOUT') ||
            error.message.includes('ENOTFOUND')
        );
    }

    async handleRetry(attempt, delay, error, url) {
        console.warn(`Retry attempt ${attempt + 1} for ${url} after ${delay}ms. Error: ${error.message}`);
        this.onRetry(attempt + 1, error, url);
        await this.sleep(delay);
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// Create a singleton instance
const fetchRetry = new FetchRetry({
    maxRetries: 3,
    initialDelay: 1000,
    maxDelay: 10000,
    onRetry: (attempt, error, url) => {
        // Optional: Update UI to show retry is happening
        const retryIndicator = document.getElementById('retryIndicator');
        if (retryIndicator) {
            retryIndicator.textContent = `Retrying request (attempt ${attempt})...`;
            retryIndicator.style.display = 'block';
            setTimeout(() => {
                retryIndicator.style.display = 'none';
            }, 2000);
        }
    }
});

// Export for use in other files
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { FetchRetry, fetchRetry };
}

// Make available globally
window.fetchRetry = fetchRetry;