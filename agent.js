#!/usr/bin/env node
'use strict';

const exec = require('child_process').exec;
const readFileSync = require('fs').readFileSync;
const os = require('os');

const IS_WINDOWS = process.platform === 'win32';
const SHELL = IS_WINDOWS ? (process.env.ComSpec || process.env.COMSPEC || 'cmd.exe') : 'bash';

let config = {};
if (
	'linux,darwin,freebsd,openbsd,sunos'.split(',').indexOf(process.platform) !== -1
) {
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
}

let VERSION = 'unknown';
try {
	VERSION = require('./package.json').version;
}
catch(e) {}
const API = config.api || 'https://l3p3.de/api/llama/v1/chat/completions';
const MODEL = config.model || 'bartowski/Qwen_Qwen3.5-9B-GGUF:IQ4_XS';
const TOOLS = [{
	type: 'function',
	function: {
		name: 'run_shell_command',
		description: 'Execute a ' + (IS_WINDOWS ? 'Windows command prompt (cmd.exe)' : 'bash') + ' command in the local environment and return stdout/stderr. Both outputs are limited to 50KB. The shell is: `' + (IS_WINDOWS ? process.cwd() + '>' : (process.env.USER || 'user') + '@' + os.hostname() + ':' + process.cwd() + '$') + '`.',
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
const FONT_GREY = '\x1b[90m';
const FONT_GREY_FAT = '\x1b[90;1m';
const FONT_NORMAL = '\x1b[0m';

const IS_HTTPS = API.startsWith('https:');
const transport = IS_HTTPS ? require('https') : require('http');
transport.globalAgent.keepAlive = true;
transport.globalAgent.options.keepAlive = true;
transport.globalAgent.options.timeout = 0;
if (
	IS_HTTPS &&
	process.versions.node.split('.')[0] < 8
) {
	transport.globalAgent.options.rejectUnauthorized = false;
	// HACK: older agents calculate the socket pool key before applying agent options
	const addRequest = transport.globalAgent.addRequest;
	transport.globalAgent.addRequest = function (request, options) {
		if (
			options &&
			typeof options === 'object' &&
			options.rejectUnauthorized === undefined
		) {
			options.rejectUnauthorized = false;
		}
		return addRequest.apply(this, arguments);
	};
}

const api_request = body => new Promise((resolve, reject) => {
	const data = JSON.stringify(body);
	const request = transport.request(API, response => {
		response.on('error', reject);
		if (response.statusCode < 200 || response.statusCode >= 300) {
			response.resume();
			reject(new Error(`api request failed with status ${response.statusCode}: ${response.statusMessage}`));
			return;
		}
		let output = '';
		response.setEncoding('utf8');
		response.on('data', chunk => { output += chunk; });
		response.on('end', () => {
			try {
				resolve(JSON.parse(output));
			}
			catch (error) {
				reject(error);
			}
		});
	});
	request.method = 'POST';
	request.setHeader('Content-Type', 'application/json');
	request.setHeader('Content-Length', Buffer.byteLength(data));
	request.setHeader('User-Agent', 'l3p3-agent/' + VERSION);
	request.setTimeout(0);
	request.on('error', reject);
	request.end(data);
});

const command_run = cmd => new Promise(resolve => {
	exec(cmd, {
		maxBuffer: 1024 * 50,
		shell: SHELL,
	}, (error, stdout, stderr) => {
		let output = stdout.trim();
		if (stderr = stderr.trim()) {
			if (output) output += '\n';
			output += '[stderr]\n' + stderr;
		}
		if (error) {
			if (output) output += '\n';
			output += '[exit code ' + error.code + ', ' + error.message + ']';
		}
		resolve(output);
	});
});

const agent_run = prompt => {
	const messages = [
		{
			role: 'system',
			content: `You are an autonomous agent running locally under ${process.platform}:${process.arch}${IS_WINDOWS ? ':v' + os.release() : ''}. You were developed by L3P3 and are on version ${VERSION}. You accomplish tasks by executing shell commands. Inspect the environment, take necessary actions, and report final results directly to the user when finished. ${IS_WINDOWS ? 'Use Windows command prompt (cmd.exe) syntax, not bash or PowerShell syntax.' : 'Use bash syntax. To view/edit files, use the sed command. Do http(s) requests with curl when you like to.'} Do not ask questions, only finish the tasks properly or stop when you think you would do serious damage the user has not intended. Clean up after yourself.`,
		},
		{
			role: 'user',
			content: prompt,
		},
	];

	const next_request = () => (
		api_request({
			model: MODEL,
			messages: messages,
			tools: TOOLS,
			tool_choice: 'auto',
			temperature: 0.1
		}).then(response => {
			const message = response.choices[0].message;
			messages.push(message);

			if (message.content) {
				console.log('[agent] ' + message.content);
			}

			if (
				!message.tool_calls ||
				!message.tool_calls.length
			) {
				return;
			}

			let tools_done = Promise.resolve();
			for (const tool_call of message.tool_calls) {
				tools_done = tools_done.then(() => {
					let output;
					if (tool_call.function.name === 'run_shell_command') {
						const args = JSON.parse(tool_call.function.arguments);
								console.log(FONT_GREY_FAT + (IS_WINDOWS ? '> ' : '$ ') + args.command + FONT_NORMAL);
						output = command_run(args.command);
					}
					else {
						output = Promise.resolve(`[unknown tool: ${tool_call.function.name}]`);
					}
					return output.then(result => {
						console.log(FONT_GREY + result + FONT_NORMAL);
						messages.push({
							role: 'tool',
							tool_call_id: tool_call.id,
							content: result,
						});
					});
				});
			}
			return tools_done.then(next_request);
		})
	);

	return next_request();
}

if (process.argv.length < 3) {
	console.error('usage: agent <prompt>');
	process.exit(1);
}

agent_run(
	process.argv.slice(2).join(' ')
).catch(error => {
	console.error(FONT_NORMAL + '\nerror:', error.message);
	process.exit(1);
});
