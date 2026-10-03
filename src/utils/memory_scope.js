import { createHash } from 'crypto';
import { existsSync, readdirSync, statSync } from 'fs';
import path from 'path';

function safeName(value) {
    return String(value || 'default')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 64) || 'default';
}

function shortHash(value) {
    return createHash('sha256').update(String(value)).digest('hex').slice(0, 10);
}

function findLatestWorld(savesPath) {
    if (!savesPath || !existsSync(savesPath)) return null;

    const candidateSaveRoots = [savesPath];
    // PrismLauncher root: <instances>/<instance>/minecraft/saves
    for (const entry of readdirSync(savesPath, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const prismSaves = path.join(savesPath, entry.name, 'minecraft', 'saves');
        if (existsSync(prismSaves)) candidateSaveRoots.push(prismSaves);
    }

    let latest = null;
    for (const saveRoot of candidateSaveRoots) {
        for (const entry of readdirSync(saveRoot, { withFileTypes: true })) {
            if (!entry.isDirectory()) continue;
            const worldPath = path.join(saveRoot, entry.name);
            const levelDat = path.join(worldPath, 'level.dat');
            if (!existsSync(levelDat)) continue;

            const sessionLock = path.join(worldPath, 'session.lock');
            const modified = Math.max(
                statSync(levelDat).mtimeMs,
                existsSync(sessionLock) ? statSync(sessionLock).mtimeMs : 0
            );
            if (!latest || modified > latest.modified) {
                latest = { name: entry.name, path: worldPath, modified };
            }
        }
    }
    return latest;
}

/**
 * Resolve a stable memory namespace. Minecraft's LAN protocol does not expose
 * the local save name, so local worlds are detected from the newest level.dat
 * in the configured saves directory or Prism instances root. An explicit
 * memory_world_id always wins.
 */
export function resolveMemoryScope(settings, server = null) {
    const configured = settings.memory_world_id;
    if (configured && configured !== 'auto') {
        return `world-${safeName(configured)}-${shortHash(configured)}`;
    }

    const localWorld = findLatestWorld(settings.minecraft_saves_path);
    if (localWorld) {
        return `world-${safeName(localWorld.name)}-${shortHash(localWorld.path)}`;
    }

    const host = server?.host || settings.host || 'unknown-host';
    const name = server?.name || 'minecraft-server';
    // Keep the port for remote servers, but not localhost LAN worlds where the
    // port changes each time "Open to LAN" is used.
    const isLocal = ['127.0.0.1', 'localhost', '::1'].includes(host);
    const identity = isLocal ? `${host}:${name}` : `${host}:${server?.port || settings.port}:${name}`;
    return `server-${safeName(name)}-${shortHash(identity)}`;
}

export { findLatestWorld };
