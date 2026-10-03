import { readFileSync, statSync } from 'fs';
import path from 'path';
import os from 'os';

let keys = {};
try {
    const data = readFileSync('./keys.json', 'utf8');
    keys = JSON.parse(data);
} catch (err) {
    console.warn('keys.json not found. Defaulting to environment variables.'); // still works with local models
}

// Reuse the machine-local CrewKit credential store when present. This keeps a
// single protected copy of hosted-provider keys instead of duplicating secrets
// into every repository. Project keys and environment variables still win.
let crewKitKeys = {};
try {
    const credentialPath = path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'crew-kit', 'credentials');
    const mode = statSync(credentialPath).mode & 0o777;
    if ((mode & 0o077) !== 0) {
        console.warn(`Ignoring CrewKit credential store with unsafe permissions (${mode.toString(8)}). Expected 600.`);
    } else {
        for (const line of readFileSync(credentialPath, 'utf8').split(/\r?\n/)) {
            const match = line.match(/^([A-Z0-9_]+):\s*(.+)$/);
            if (match) crewKitKeys[match[1]] = match[2].trim();
        }
    }
} catch {
    // CrewKit is optional.
}

export function getKey(name) {
    let key = keys[name];
    if (!key) {
        key = process.env[name] || crewKitKeys[name];
    }
    if (!key) {
        throw new Error(`API key "${name}" not found in keys.json or environment variables!`);
    }
    return key;
}

export function hasKey(name) {
    return keys[name] || process.env[name] || crewKitKeys[name];
}

export function getFirstKey(...names) {
    for (const name of names) {
        if (hasKey(name)) return getKey(name);
    }
    throw new Error(`None of the API keys were found: ${names.join(', ')}`);
}
