# agent

a local command-line agent for an openai-compatible chat api. requires node.js 5.2 or newer.

## examples

- `$ npx @l3p3/agent "build this project"`
- `$ agent "what is your version?"` (after `npm install -g @l3p3/agent`)
- `# agent "fix apt upgrade"`

> [!CAUTION]
> the agent does whatever it can. do not blame me for damages.
> on node.js < 8, https certificate verification is disabled.

## use your own llm api

when you have your own llama-server running, put this into `/etc/agent.json`:

```json
{
  "api": "http://localhost:8080/v1/chat/completions",
  "model": "llama-2-7b-chat.ggmlv3.q4_0.bin"
}
```

both settings are optional, values are examples.
