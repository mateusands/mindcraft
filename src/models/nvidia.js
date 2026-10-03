import OpenAIApi from 'openai';
import { getKey } from '../utils/keys.js';
import { strictFormat } from '../utils/text.js';

export class Nvidia {
    static prefix = 'nvidia';

    constructor(modelName, url, params) {
        this.model_name = modelName;
        this.params = { ...(params || {}) };
        const requestTimeout = Number(this.params.request_timeout_ms || 4500);
        delete this.params.request_timeout_ms;
        this.openai = new OpenAIApi({
            apiKey: getKey('NVIDIA_API_KEY'),
            baseURL: url || 'https://integrate.api.nvidia.com/v1',
            defaultHeaders: { 'NVCF-POLL-SECONDS': '3600' },
            timeout: requestTimeout,
            maxRetries: 0
        });
    }

    async sendRequest(turns, systemMessage, stopSequence = null) {
        const messages = strictFormat([{ role: 'system', content: systemMessage }, ...turns]);
        const completion = await this.openai.chat.completions.create({
            model: this.model_name || 'deepseek-ai/deepseek-v4.1-flash',
            messages,
            stream: false,
            ...(stopSequence ? { stop: stopSequence } : {}),
            ...this.params
        });
        const content = completion.choices?.[0]?.message?.content;
        if (!content) throw new Error('NVIDIA returned no text content.');
        return content.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    }

    async embed(text, inputType = 'query') {
        const response = await this.openai.embeddings.create({
            model: this.model_name || 'nvidia/nemotron-3-embed-1b',
            input: Array.isArray(text) ? text : [text],
            encoding_format: 'float',
            input_type: inputType,
            truncate: 'END'
        });
        return response.data[0].embedding;
    }
}
