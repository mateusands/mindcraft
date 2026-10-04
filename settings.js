const settings = {
    "minecraft_version": "auto", // or specific version like "1.21.6"
    "host": "127.0.0.1", // or "localhost", "your.ip.address.here"
    "port": 45975, // set to -1 to automatically scan for open ports
    "auth": "offline", // or "microsoft"

    // the mindserver manages all agents and hosts the UI
    "mindserver_port": 8080,
    "auto_open_ui": true, // opens UI in browser on startup
    
    "base_profile": "assistant", // survival, assistant, creative, or god_mode
    "profiles": [
        "./andy.json",
        // "./profiles/gpt.json",
        // "./profiles/claude.json",
        // "./profiles/gemini.json",
        // "./profiles/llama.json",
        // "./profiles/qwen.json",
        // "./profiles/grok.json",
        // "./profiles/mistral.json",
        // "./profiles/deepseek.json",
        // "./profiles/mercury.json",
        // "./profiles/andy-4.json", // Supports up to 75 messages!

        // using more than 1 profile requires you to /msg each bot indivually
        // individual profiles override values from the base profile
    ],

    "load_memory": true, // load memory only from the current Minecraft world/save
    "memory_world_id": "auto", // auto = newest local save; set a fixed name for remote servers
    "minecraft_saves_path": "/home/mateuswzt/.local/share/PrismLauncher/instances",
    "init_message": null, // do not inject a recurring task into the saved conversation
    "only_chat_with": [], // users that the bots listen to and send general messages to. if empty it will chat publicly

    "speak": false,
    // allows all bots to speak through text-to-speech. 
    // specify speech model inside each profile with format: {provider}/{model}/{voice}.
    // if set to "system" it will use basic system text-to-speech. 
    // Works on windows and mac, but linux requires you to install the espeak package through your package manager eg: `apt install espeak` `pacman -S espeak`.

    "chat_ingame": true, // bot responses are shown in minecraft chat
    "language": "en", // translate to/from this language. Supports these language names: https://cloud.google.com/translate/docs/languages
    "render_bot_view": false, // show bot's view in browser at localhost:3000, 3001...

    "allow_insecure_coding": false, // allows newAction command and model can write/run code on your computer. enable at own risk
    "allow_vision": false, // allows vision model to interpret screenshots as inputs
    "blocked_actions" : ["!newAction", "!checkBlueprint", "!checkBlueprintLevel", "!getBlueprint", "!getBlueprintLevel"] , // keep model-generated host code hidden; use deterministic skills instead
    "code_timeout_mins": -1, // minutes code is allowed to run. -1 for no timeout
    "relevant_docs_count": 3, // compact command context for faster local inference
    "relevant_knowledge_count": 2, // only the two strongest Minecraft knowledge matches
    "knowledge_database": "./bots/shared/minecraft_knowledge.sqlite", // hybrid SQLite FTS5 + sqlite-vec RAG index

    "max_messages": 10, // compact history for faster, more focused local inference
    "num_examples": 1, // one highly relevant example is enough for the Minecraft-tuned model
    "max_commands": -1, // max number of commands that can be used in consecutive responses. -1 for no limit
    "show_command_syntax": "full", // "full", "shortened", or "none"
    "narrate_behavior": true, // chat simple automatic actions ('Picking up item!')
    "chat_bot_messages": true, // publicly chat messages to other bots

    "spawn_timeout": 30, // num seconds allowed for the bot to spawn before throwing error. Increase when spawning takes a while.
    "block_place_delay": 0, // delay between placing blocks (ms) if using newAction. helps avoid bot being kicked by anti-cheat mechanisms on servers.
    "position_packet_throttle_ms": 0, // keep 0 for vanilla/LAN; only raise for a server that rate-limits movement packets
    "escape_on_damage": false, // legacy setting; damage alone never triggers a panic sprint
  
    "log_all_prompts": false, // log ALL prompts to file
};

export default settings;
