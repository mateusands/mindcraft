import { getKey } from '../utils/keys.js';
import { strictFormat } from '../utils/text.js';

export class MiMo {
    static prefix = 'mimo';

    constructor(modelName, url, params) {
        this.model_name = modelName || 'mimo-v2.6-flash';
        this.params = { ...(params || {}) };
        this.requestTimeout = Number(this.params.request_timeout_ms || 6000);
        delete this.params.request_timeout_ms;
        this.apiKey = getKey('MIMO_API_KEY');
        this.baseURL = (url || 'https://token-plan-sgp.xiaomimimo.com/anthropic').replace(/\/$/, '');
    }

    async sendRequest(turns, systemMessage) {
        const response = await fetch(`${this.baseURL}/v1/messages`, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'authorization': `Bearer ${this.apiKey}`,
                'x-api-key': this.apiKey,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
                model: this.model_name,
                system: systemMessage,
                messages: strictFormat(turns),
                max_tokens: 1024,
                ...this.params
            }),
            signal: AbortSignal.timeout(this.requestTimeout)
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(`MiMo HTTP ${response.status}: ${data.error?.message || 'request failed'}`);
        const content = data.content?.find(item => item.type === 'text')?.text;
        if (!content) throw new Error('MiMo returned no text content.');
        return content.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    }

    async embed() {
        throw new Error('MiMo does not provide embeddings through this endpoint.');
    }
}
