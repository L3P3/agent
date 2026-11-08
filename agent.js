#!/usr/bin/env node
import { exec } from 'child_process';
import { readFileSync } from 'fs';
import readline from 'readline';
import { Agent } from 'undici';

let config = {};
try {
	config = JSON.parse(
		readFileSync('/etc/agent.json', 'utf-8')
	);
	if (!config) throw new Error('error: config file is empty');
}
catch (err) {
	if (err.code !== 'ENOENT') {
		console.error(err.message);
		process.exit(1);
	}
}

const API = config.api || 'https://l3p3.de/api/llama/v1/chat/completions';
const MODEL = config.model || 'bartowski/Qwen_Qwen3.5-9B-GGUF:IQ4_XS';
const TOOLS = [{
	type: 'function',
	function: {
		name: 'run_shell_command',
		description: 'Execute a bash shell command in the local environment and return stdout/stderr. Both output buffers are limited to 50KB.',
		parameters: {
			type: 'object',
			properties: {
				command: {
					type: 'string',
					description: 'The exact shell command to execute.',
				},
			},
			required: ['command'],
		},
	},
}];

const dispatcher = new Agent({
	headersTimeout: 0,
	bodyTimeout: 0,
});

const command_run = cmd => new Promise(resolve => {
	exec(cmd, {
		maxBuffer: 1024 * 50,
	}, (error, stdout, stderr) => {
		resolve(
`[stdout]
${stdout.trim() || '[empty]'}
[stderr]
${stderr.trim() || '[empty]'}
[exit code: ${error ? error.code + ', ' + error.message : 0}]`
		);
	});
});

async function agent_run(prompt) {
	const messages = [
		{
			role: 'system',
			content: 'You are an autonomous CLI agent running locally. You accomplish tasks by executing shell commands. Inspect the environment, take necessary actions, and report final results directly to the user when finished.',
		},
		{
			role: 'user',
			content: prompt,
		},
	];

	while (true) {
		const response = await fetch(API, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'User-Agent': 'agent.js/0.1',
			},
			body: JSON.stringify({
				model: MODEL,
				messages: messages,
				tools: TOOLS,
				tool_choice: 'auto',
				temperature: 0.1
			}),
			dispatcher,
		});
		if (!response.ok) {
			throw new Error(`api request failed with status ${response.status}: ${response.statusText}`);
		}

		const {message} = (
			await response.json()
		).choices[0];
		messages.push(message);

		if (message.content) {
			console.log('[agent]', message.content);
		}

		if (
			!message.tool_calls ||
			!message.tool_calls.length
		) {
			break;
		}

		for (const tool_call of message.tool_calls) {
			let output = `[unknown tool: ${tool_call.function.name}]`;
			if (tool_call.function.name === 'run_shell_command') {
				const args = JSON.parse(tool_call.function.arguments);
				console.log('$', args.command);
				output = await command_run(args.command);
			}
			console.log(output);
			messages.push({
				role: 'tool',
				tool_call_id: tool_call.id,
				content: output,
			});
		}
	}
}

if (process.argv.length < 3) {
	console.error('usage: agent <prompt>');
	process.exit(1);
}

agent_run(
	process.argv.slice(2).join(' ')
).catch(error => {
	console.error('\nerror:', error.message);
	process.exit(1);
});
