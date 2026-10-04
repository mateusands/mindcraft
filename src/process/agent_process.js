import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { logoutAgent } from '../mindcraft/mindserver.js';

const init_agent_path = fileURLToPath(new URL('./init_agent.js', import.meta.url));

export class AgentProcess {
    constructor(name, port) {
        this.name = name;
        this.port = port;
        this.restartAttempts = 0;
        this.restartTimer = null;
    }

    start(load_memory=false, init_message=null, count_id=0) {
        this.count_id = count_id;
        this.running = true;

        let args = [init_agent_path, this.name];
        args.push('-n', this.name);
        args.push('-c', count_id);
        if (load_memory)
            args.push('-l', load_memory);
        if (init_message)
            args.push('-m', init_message);
        args.push('-p', this.port);

        const agentProcess = spawn(process.execPath, args, {
            stdio: 'inherit',
            stderr: 'inherit',
        });
        
        const startedAt = Date.now();
        agentProcess.on('exit', (code, signal) => {
            console.log(`Agent process exited with code ${code} and signal ${signal}`);
            this.running = false;
            logoutAgent(this.name);
            
            if (code > 1) {
                console.log(`Ending task`);
                process.exit(code);
            }

            if (code !== 0 && signal !== 'SIGINT') {
                // Keep retrying transient Minecraft/LAN disconnects. A quick
                // reconnect can fail while the server is still releasing the
                // previous session, so use bounded exponential backoff rather
                // than permanently abandoning the agent.
                const runtime = Date.now() - startedAt;
                this.restartAttempts = runtime >= 30000 ? 0 : this.restartAttempts + 1;
                const delayMs = Math.min(30000, 2000 * (2 ** Math.min(Math.max(this.restartAttempts - 1, 0), 4)));
                console.log(`Restarting agent in ${delayMs / 1000}s (attempt ${this.restartAttempts})...`);
                clearTimeout(this.restartTimer);
                this.restartTimer = setTimeout(() => {
                    this.restartTimer = null;
                    // Load the same world's memory and resume the interrupted
                    // task after the Minecraft session is available again.
                    this.start(
                        true,
                        'You reconnected after an interruption. Check your current state and continue the most recent unfinished player request. Do not merely announce the restart.',
                        count_id
                    );
                }, delayMs);
            }
        });
    
        agentProcess.on('error', (err) => {
            console.error('Agent process error:', err);
        });

        this.process = agentProcess;
    }

    stop() {
        if (this.restartTimer) {
            clearTimeout(this.restartTimer);
            this.restartTimer = null;
        }
        if (!this.running) return;
        this.process.kill('SIGINT');
    }

    forceRestart() {
        if (this.running && this.process && !this.process.killed) {
            console.log(`Agent process for ${this.name} is still running. Attempting to force restart.`);
            
            const restartTimeout = setTimeout(() => {
                console.warn(`Agent ${this.name} did not stop in time. It might be stuck.`);
            }, 5000); // 5 seconds to exit

            this.process.once('exit', () => {
                 clearTimeout(restartTimeout);
                 console.log(`Stopped hanging agent ${this.name}. Now restarting.`);
                 this.start(true, 'Agent process restarted.', this.count_id);
            });
            this.stop(); // sends SIGINT
        } else {
             this.start(true, 'Agent process restarted.', this.count_id);
        }
    }
}
