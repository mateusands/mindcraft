const FAILURE_TEXT = /brain disconnected|no response data|no response from/i;

function timeout(promise, timeoutMs, providerName) {
    let timer;
    return Promise.race([
        promise,
        new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error(`${providerName} timed out after ${timeoutMs}ms`)), timeoutMs);
        })
    ]).finally(() => clearTimeout(timer));
}

export class ModelRouter {
    constructor(providers, options = {}) {
        this.providers = providers.map((provider, index) => ({
            name: provider.name || `provider-${index + 1}`,
            model: provider.model,
            rpm: provider.rpm || Infinity,
            timeoutMs: provider.timeout_ms || options.timeout_ms || 8000,
            cooldownMs: provider.cooldown_ms || options.cooldown_ms || 30000,
            requests: [],
            unavailableUntil: 0
        }));
    }

    _reserve(provider) {
        const now = Date.now();
        provider.requests = provider.requests.filter(timestamp => now - timestamp < 60000);
        if (now < provider.unavailableUntil || provider.requests.length >= provider.rpm) return false;
        provider.requests.push(now);
        return true;
    }

    async sendRequest(turns, systemMessage, stopSequence = null) {
        const failures = [];
        for (const provider of this.providers) {
            if (!this._reserve(provider)) {
                console.warn(`[router] Skipping ${provider.name}: rate limit or circuit open.`);
                continue;
            }
            const started = Date.now();
            try {
                const result = await timeout(
                    provider.model.sendRequest(turns, systemMessage, stopSequence),
                    provider.timeoutMs,
                    provider.name
                );
                if (typeof result !== 'string' || !result.trim() || FAILURE_TEXT.test(result)) {
                    throw new Error('provider returned an unusable response');
                }
                console.log(`[router] ${provider.name} answered in ${Date.now() - started}ms.`);
                return result;
            } catch (error) {
                provider.unavailableUntil = Date.now() + provider.cooldownMs;
                failures.push(`${provider.name}: ${error.message}`);
                console.warn(`[router] ${provider.name} failed after ${Date.now() - started}ms; trying fallback.`);
            }
        }
        throw new Error(`All model providers failed (${failures.join('; ')}).`);
    }
}
