import { mkdirSync, writeFileSync } from 'fs';
import path from 'path';
import OpenAI from 'openai';
import { getKey } from '../src/utils/keys.js';

const outputPath = path.resolve('./bots/andy/launcher-profile.json');

const modes = {
    self_preservation: true,
    unstuck: true,
    cowardice: false,
        self_defense: true,
    hunting: false,
    item_collecting: true,
    torch_placing: true,
    elbow_room: true,
    idle_staring: true,
    cheat: false
};

const mimo = () => ({
    name: 'xiaomi-mimo-flash',
    api: 'mimo',
    model: 'mimo-v2.6-flash',
    timeout_ms: 12500,
    cooldown_ms: 3000,
    params: { request_timeout_ms: 12000, max_tokens: 600, temperature: 0.2 }
});

const groq = () => ({
    name: 'groq-qwen-fast',
    api: 'groq',
    model: 'qwen/qwen3.8-27b',
    timeout_ms: 4000,
    cooldown_ms: 3000,
    params: { request_timeout_ms: 3500, max_completion_tokens: 600, temperature: 0.2 }
});

const nvidia = () => ({
    name: 'nvidia-deepseek-flash',
    api: 'nvidia',
    model: 'deepseek-ai/deepseek-v4.1-flash',
    rpm: 38,
    timeout_ms: 5000,
    cooldown_ms: 300000,
    params: { request_timeout_ms: 4500, max_tokens: 600, temperature: 0.2 }
});

const ollama = () => ({
    name: 'ollama-qwen-local',
    api: 'ollama',
    model: 'qwen3:1.7b',
    timeout_ms: 12000,
    cooldown_ms: 3000,
    params: {
        think: false,
        keep_alive: '30m',
        options: { temperature: 0.2, num_predict: 400, num_ctx: 8192 }
    }
});

const andy4 = () => ({
    name: 'ollama-andy-4-micro-minecraft',
    api: 'ollama',
    model: 'sweaterdog/andy-4:micro-q8_0',
    timeout_ms: 30000,
    cooldown_ms: 3000,
    params: {
        think: false,
        keep_alive: '30m',
        options: { temperature: 0.1, num_predict: 1200, num_ctx: 8192 }
    }
});

const openai = (model = 'gpt-6-luna', effort = 'low') => ({
    name: `openai-${model}`,
    api: 'openai',
    model,
    timeout_ms: 15000,
    cooldown_ms: 5000,
    params: { reasoning: { effort }, request_timeout_ms: 15000, max_retries: 0 }
});

function makeProfile(providers) {
    const [primary, ...fallbacks] = providers;
    const profile = {
        name: 'andy',
        model: primary,
        embedding: false,
        modes
    };
    if (fallbacks.length) {
        profile.fallback_models = fallbacks;
        profile.model_router = { timeout_ms: 12500, cooldown_ms: 3000 };
    }
    return profile;
}

async function listOpenAIModels() {
    const preferred = [
        ['gpt-6-luna', 'GPT-6 Luna — rápido e econômico'],
        ['gpt-6.1-sol', 'GPT-6.1 Sol — equilíbrio'],
        ['gpt-6-astra', 'GPT-6 Astra — máxima capacidade'],
        ['gpt-5.6-terra', 'GPT-5.6 Terra — equilibrado'],
        ['gpt-5.6-sol', 'GPT-5.6 Sol'],
        ['gpt-5.6-luna', 'GPT-5.6 Luna — econômico'],
        ['gpt-5.4-mini', 'GPT-5.4 Mini']
    ];
    const client = new OpenAI({
        apiKey: getKey('OPENAI_API_KEY'),
        timeout: 10000,
        maxRetries: 0
    });
    const page = await client.models.list();
    const available = new Set();
    for await (const model of page) available.add(model.id);
    for (const [id, label] of preferred) {
        if (available.has(id)) console.log(`${id}|${label}`);
    }
}

async function main() {
    const command = process.argv[2];
    if (command === 'list-openai') {
        await listOpenAIModels();
        return;
    }

    const preset = command || 'mimo-groq';
    const model = process.argv[3];
    const effort = process.argv[4] || 'low';
    let providers;
    switch (preset) {
        case 'mimo-groq': providers = [mimo(), groq()]; break;
        case 'groq-mimo': providers = [groq(), mimo()]; break;
        case 'mimo': providers = [mimo()]; break;
        case 'groq': providers = [groq()]; break;
        case 'nvidia': providers = [nvidia()]; break;
        case 'ollama': providers = [ollama()]; break;
        case 'andy4': providers = [andy4()]; break;
        case 'openai': providers = [openai(model, effort)]; break;
        case 'automatic': providers = [nvidia(), groq(), mimo(), ollama(), { ...openai('gpt-6-luna', 'low'), rpm: 1 }]; break;
        default: throw new Error(`Unknown launcher preset: ${preset}`);
    }

    mkdirSync(path.dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, JSON.stringify(makeProfile(providers), null, 4) + '\n');
    console.log(outputPath);
}

main().catch(error => {
    console.error(error.message);
    process.exit(1);
});
