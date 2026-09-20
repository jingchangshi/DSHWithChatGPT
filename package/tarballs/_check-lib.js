import Schema from "@deepseek-ai/schemastery";
import { mountSessionMcp } from "@deepseek-ai/dsh-experimental-browser-use-runtime/mcp";
import { readFile } from "node:fs/promises";
import { isImageAdmissionError } from "@deepseek-ai/dsh-attachment";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { parse } from "yaml";
import { isSkillName } from "@deepseek-ai/dsh-skill";
//#region lib/types/screenshot.js
/**
* Project a Browser Harness screenshot path into durable model-visible content.
*
* `browser_screenshot` returns `{"path", "width", "height", "size_bytes"}` as
* text, because the upstream server writes a PNG to disk instead of returning
* MCP `ImageContent`. DSH's MCP bridge only stores an image when the result
* already contains an `image` block, so without this projection the model
* receives a local path and never the picture.
*
* The provider owns that convention, so it supplies the projection through the
* shared MCP client's `projectResult` seam rather than teaching the bridge about
* one upstream server.
*
* @module
*/
/** The only upstream tool this provider projects. */
const SCREENSHOT_TOOL = "browser_screenshot";
/** Raster formats the durable attachment vocabulary accepts, by PNG signature. */
const PNG_MEDIA_TYPE = "image/png";
/** Bound a screenshot before reading it, so a rogue path cannot exhaust memory. */
const MAX_SCREENSHOT_BYTES = 32 * 1024 * 1024;
/**
* Read the PNG path and image dimensions out of one raw screenshot result.
*
* The upstream text is JSON, and its exact shape is the upstream contract; a
* missing or malformed field degrades to a diagnostic instead of failing the
* completed browser action.
*
* @param context - the raw result and its upstream tool name.
* @returns the absolute path plus declared dimensions, or undefined when this result is not a screenshot payload.
*/
function screenshotPayload(context) {
	if (context.rawName !== SCREENSHOT_TOOL) return void 0;
	const text = context.result.content.map((block) => isTextBlock(block) ? block.text : "").join("\n");
	let parsed;
	try {
		parsed = JSON.parse(text);
	} catch {
		return;
	}
	if (typeof parsed !== "object" || parsed === null) return void 0;
	const record = parsed;
	if (typeof record.path !== "string" || record.path === "" || "error" in record) return void 0;
	return {
		path: record.path,
		...typeof record.width === "number" ? { width: record.width } : {},
		...typeof record.height === "number" ? { height: record.height } : {}
	};
}
function isTextBlock(block) {
	return typeof block === "object" && block !== null && !Array.isArray(block) && block.type === "text" && typeof block.text === "string";
}
/**
* Resolve the attachment store and prove the active model route accepts images.
*
* This mirrors the shared bridge's admission rule: an image is stored only when
* the calling Agent's resolved model declares image input. The route is read
* from the exact tool execution so a Session that switched models mid-turn is
* judged by the route actually serving it.
*
* @param ctx - provider context carrying optional attachment, LLM, and logger services.
* @param context - the exact tool execution whose Agent supplies the route.
* @returns the attachment store after positive image-capability proof.
*/
async function resolveAdmission(ctx, context) {
	const attachments = ctx.get("attachments");
	if (attachments === void 0) throw new Error("no attachment store is mounted");
	const { execution } = context;
	const routed = execution.agent?.session.requestHeader()?.config;
	const provider = routed?.provider ?? execution.agent?.options.provider;
	const model = routed?.model ?? execution.agent?.options.model;
	const llm = ctx.get("llm");
	if (provider === void 0 || model === void 0 || llm === void 0) throw new Error("the current model route could not be resolved");
	let info;
	try {
		info = await llm.resolveModelInfo(provider, model, execution.signal);
	} catch {
		throw new Error("the current model route could not be verified");
	}
	if (info.inputModalities === void 0 || !info.inputModalities.includes("image")) throw new Error(`model "${model}" does not declare image input`);
	if (execution.signal.aborted) throw new Error("the tool call was canceled before image storage");
	return attachments;
}
/** Stable diagnostic text for a screenshot that stayed a path. */
function pathDiagnostic(payload, reason) {
	return [{
		type: "text",
		text: `[screenshot not shown: ${reason}; the PNG remains at ${payload.path}]`
	}];
}
/**
* Build the projection that turns a screenshot path into a durable image block.
*
* Every failure path returns text instead of throwing: the screenshot itself
* succeeded, so the model should still learn where the file is.
*
* @param ctx - provider context carrying optional attachment and LLM services.
* @returns a projector for the shared MCP client's `projectResult` seam.
*/
function createScreenshotProjection(ctx) {
	return async (context) => {
		const payload = screenshotPayload(context);
		if (payload === void 0) return [];
		let attachments;
		try {
			attachments = await resolveAdmission(ctx, context);
		} catch (error) {
			return pathDiagnostic(payload, reasonOf(error));
		}
		let data;
		try {
			data = await readFile(payload.path);
		} catch {
			return pathDiagnostic(payload, "the screenshot file could not be read");
		}
		if (data.byteLength > MAX_SCREENSHOT_BYTES) return pathDiagnostic(payload, `the screenshot exceeds ${String(MAX_SCREENSHOT_BYTES)} bytes`);
		try {
			const [ref] = await attachments.saveImages([{
				data,
				mediaType: PNG_MEDIA_TYPE
			}]);
			return [{
				type: "image",
				attachment: ref
			}];
		} catch (error) {
			return pathDiagnostic(payload, isImageAdmissionError(error) ? `image admission rejected the screenshot: ${error.message}` : "durable image storage rejected the screenshot");
		}
	};
}
/** Render an unknown failure as a diagnostic fragment. */
function reasonOf(error) {
	return error instanceof Error ? error.message : String(error);
}
//#endregion
//#region lib/types/skill.js
/**
* Publish Browser Harness' own usage skill through the DSH skill registry.
*
* `browser-harness skill` prints a complete `SKILL.md` — YAML frontmatter plus
* body — that teaches the model when a browser is warranted and how to drive the
* harness. This module registers ONE skill with the existing DSH skill registry,
* so it reaches the model through the same catalog, ranking, and loader as every
* filesystem or bundled skill. No second skill loader exists.
*
* The registry is passed in rather than read from `ctx` because `skills` is
* optional for this provider: declaring it in `inject` would refuse activation
* whenever a composition omits the skill service, while a bare `ctx.skills`
* access is rejected for an undeclared service.
*
* The body is the upstream text verbatim. DSH parses the frontmatter and takes
* the name, description, and optional metadata from it; rewriting the body would
* fork upstream documentation.
*
* @module
*/
const run = promisify(execFile);
/** Rank below bundled providers so a user's own skill of the same name wins. */
const SKILL_RANK = 500;
/** Bound the upstream command so a hung install cannot stall catalog discovery. */
const SKILL_TIMEOUT_MS = 3e4;
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
/**
* Split an upstream `SKILL.md` into its frontmatter fields and body.
*
* @param text - complete upstream skill document.
* @returns the parsed fields and the remaining body, or undefined when the document is not a usable skill.
*/
function parseSkillDocument(text) {
	const match = FRONTMATTER.exec(text);
	if (match === null) return void 0;
	let parsed;
	try {
		parsed = parse(match[1] ?? "");
	} catch {
		return;
	}
	if (typeof parsed !== "object" || parsed === null) return void 0;
	const record = parsed;
	const name = record.name;
	const description = record.description;
	if (typeof name !== "string" || !isSkillName(name)) return void 0;
	if (typeof description !== "string" || description.trim() === "") return void 0;
	return {
		frontmatter: {
			name,
			description,
			...typeof record.when_to_use === "string" ? { whenToUse: record.when_to_use } : {}
		},
		body: text.slice(match[0].length)
	};
}
/**
* Run the upstream command that prints the skill document.
*
* A missing or failing executable yields undefined rather than throwing:
* browser tooling is optional, and its absence must not break skill discovery
* for every other provider.
*
* @param command - installed Browser Harness executable.
* @param env - environment overrides carrying the configured home and daemon name.
* @param signal - registration-scoped cancellation.
* @returns the upstream document, or undefined when it could not be produced.
*/
async function readUpstreamSkill(command, args, env, signal) {
	try {
		const { stdout } = await run(command, [...args, "skill"], {
			env: {
				...process.env,
				...env
			},
			timeout: SKILL_TIMEOUT_MS,
			maxBuffer: 4 * 1024 * 1024,
			windowsHide: true,
			signal
		});
		return stdout;
	} catch {
		return;
	}
}
/**
* Register the Browser Harness usage skill on the existing skill registry.
*
* The document is read once per catalog discovery and cached by the registry,
* so the upstream executable runs at most once per catalog generation.
*
* @param ctx - context carrying the `skills` registry.
* @param options - the installed command and any environment overrides.
* @returns a disposer releasing the registration.
*/
function registerBrowserHarnessSkill(skills, options) {
	const args = options.args ?? [];
	return skills.registerProvider((control) => {
		/** Per-discovery cache; the registry may call `list` and `get` separately. */
		let cached;
		let loaded = false;
		/** Read the document once, remembering a definitive absence. */
		async function load() {
			if (!loaded) {
				loaded = true;
				const text = await readUpstreamSkill(options.command, args, options.env, control.signal);
				if (text !== void 0) {
					const parsed = parseSkillDocument(text);
					if (parsed !== void 0) cached = {
						candidate: {
							name: parsed.frontmatter.name,
							description: parsed.frontmatter.description,
							...parsed.frontmatter.whenToUse === void 0 ? {} : { whenToUse: parsed.frontmatter.whenToUse },
							invocation: {
								modelInvocable: true,
								userInvocable: true
							},
							source: "custom",
							provider: "browser-harness",
							rank: SKILL_RANK,
							locator: parsed.frontmatter.name
						},
						body: parsed.body
					};
				}
			}
			return cached;
		}
		return {
			name: "browser-harness",
			list: async (_options) => {
				const entry = await load();
				return entry === void 0 ? [] : [entry.candidate];
			},
			get: async (candidate, _options) => {
				const entry = await load();
				if (entry === void 0 || entry.candidate.name !== candidate.name) return void 0;
				return {
					...entry.candidate,
					content: entry.body
				};
			}
		};
	});
}
//#endregion
//#region lib/types/index.js
/** Browser Harness tools over its stdio MCP server, attached to the user's running Chrome. @module */
/** Cordis identity for the Browser Harness MCP browser provider. */
const name = "experimental-browser-use-browser-harness-mcp";
/** Services required for scoped MCP startup and prompt readiness checks. */
const inject = [
	"browserUse",
	"agents",
	"tools",
	"systemPrompt"
];
/** Validate provider settings before the provider reserves browser use. */
const Config = Schema.object({
	command: Schema.string().default("browser-harness-mcp"),
	args: Schema.array(Schema.string()).default([]),
	toolCallTimeoutMs: Schema.number().min(1),
	home: Schema.string().pattern(/\S/u),
	daemonName: Schema.string().pattern(/^[A-Za-z0-9_-]{1,64}$/u),
	requireExistingDaemon: Schema.boolean(),
	record: Schema.boolean(),
	tabMarker: Schema.boolean(),
	cdpUrl: Schema.string().pattern(/^https?:\/\/[^\s/]+/u),
	cdpWs: Schema.string().pattern(/^wss?:\/\/[^\s/]+/u)
});
/** Upstream environment variables this provider is allowed to set. */
const ENVIRONMENT_KEYS = [
	"BH_HOME",
	"BU_NAME",
	"BH_REQUIRE_EXISTING_DAEMON",
	"BH_RECORD",
	"BH_TAB_MARKER",
	"BU_CDP_URL",
	"BU_CDP_WS"
];
/** Upstream boolean vocabulary for the `BH_*` switches. */
const FLAG_VALUE = {
	record: (value) => value ? "1" : "0",
	tabMarker: (value) => value ? "1" : "0",
	requireExistingDaemon: (value) => value ? "1" : ""
};
/**
* Reject a setting the provider cannot express safely.
*
* Both endpoints name one browser, so configuring two would silently ignore
* one of them. An absent option must stay absent: Browser Harness reads its own
* stored recording and tab-marker preferences, and an empty string would
* override them rather than leave them alone.
*
* @param config - schema-validated provider settings.
*/
function validateConfig(config) {
	if (config.command.trim() === "") throw new Error("browser-harness: the MCP server command must not be empty");
	if (config.cdpUrl !== void 0 && config.cdpWs !== void 0) throw new Error("browser-harness: cdpUrl and cdpWs name the same browser; configure exactly one");
	for (const [key, value] of [["cdpUrl", config.cdpUrl], ["cdpWs", config.cdpWs]]) {
		if (value === void 0) continue;
		let endpoint;
		try {
			endpoint = new URL(value);
		} catch (error) {
			throw new Error(`browser-harness: ${key} must be a valid URL`, { cause: error });
		}
		if (/^cdpUrl$/u.test(key) ? endpoint.protocol !== "http:" && endpoint.protocol !== "https:" : endpoint.protocol !== "ws:" && endpoint.protocol !== "wss:") throw new Error(`browser-harness: ${key} must use ${key === "cdpUrl" ? "HTTP(S)" : "WS(S)"}`);
	}
}
/**
* Build the upstream environment overrides for the configured settings.
*
* Only configured options contribute; every variable this returns is one
* Browser Harness actually reads, so a default here can never silently replace
* a user's stored preference.
*
* @param config - schema-validated provider settings.
* @returns environment overrides, empty when nothing is configured.
*/
function buildEnvironment(config) {
	const environment = {};
	if (config.home !== void 0) environment.BH_HOME = config.home;
	if (config.daemonName !== void 0) environment.BU_NAME = config.daemonName;
	if (config.requireExistingDaemon !== void 0) environment.BH_REQUIRE_EXISTING_DAEMON = FLAG_VALUE.requireExistingDaemon(config.requireExistingDaemon);
	if (config.record !== void 0) environment.BH_RECORD = FLAG_VALUE.record(config.record);
	if (config.tabMarker !== void 0) environment.BH_TAB_MARKER = FLAG_VALUE.tabMarker(config.tabMarker);
	if (config.cdpUrl !== void 0) environment.BU_CDP_URL = config.cdpUrl;
	if (config.cdpWs !== void 0) environment.BU_CDP_WS = config.cdpWs;
	return environment;
}
/**
* Expose Browser Harness' upstream catalog to one live Session at a time.
*
* One Browser Harness daemon drives one shared browser through mutable
* current-tab state, so concurrent Sessions would interleave `switch_tab` and
* act on each other's tab; `exclusive: true` reserves that single lane. The
* browser stays externally owned: disposing this provider closes only the DSH
* MCP client, leaving the daemon and the user's Chrome running.
*
* @param ctx - provider context supplying browser use, Agents, tools, and prompt assembly.
* @param config - validated installation, daemon, and endpoint settings.
*/
function apply(ctx, config) {
	validateConfig(config);
	const environment = buildEnvironment(config);
	mountSessionMcp(ctx, {
		name: "browser-harness",
		exclusive: true,
		command: config.command,
		args: config.args,
		projectResult: createScreenshotProjection(ctx),
		...Object.keys(environment).length === 0 ? {} : { env: environment },
		...config.toolCallTimeoutMs === void 0 ? {} : { toolCallTimeoutMs: config.toolCallTimeoutMs }
	});
	const skills = ctx.get("skills");
	if (skills !== void 0) ctx.effect(() => registerBrowserHarnessSkill(skills, {
		command: resolveSkillCommand(config.command),
		env: environment
	}), "browser-harness.skill");
}
/**
* Locate the executable that prints the Browser Harness usage skill.
*
* `browser-harness-mcp` ships beside `browser-harness`, and the task configures
* only the MCP executable, so the skill command is derived from it instead of
* widening the config surface with a second path the user must keep in sync.
*
* @param command - configured MCP server executable.
* @returns the sibling CLI path, or the configured command when it is not the MCP server.
*/
function resolveSkillCommand(command) {
	return command.replace(/browser-harness-mcp(?=\.exe$|$)/u, "browser-harness");
}
/** Upstream variables this provider owns, exported for documentation checks. */
const environmentKeys = ENVIRONMENT_KEYS;
//#endregion
export { Config, apply, buildEnvironment, environmentKeys, inject, name, resolveSkillCommand, validateConfig };
