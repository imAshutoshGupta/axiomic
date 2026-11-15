import type { RenderedFile } from "@axiomic/shared";
import { apiCall, ApiError, type ApiCallOptions } from "./api-client";
import { isTokenShape } from "./auth";
import { isValidSlug } from "./project-config";

/**
 * One function per /api/v1 endpoint (DECISIONS #55). Each checks the shape of the answer
 * before anything else uses it: a broken or hostile server gets an error, not a crash or a
 * strange file. (File paths and sizes are checked again by the writer.)
 */

const bad = (what: string) => new ApiError(0, `the server sent an unexpected ${what}`);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown, max = 500): v is string => typeof v === "string" && v.length <= max;

/**
 * Text from the server that gets PRINTED (names, titles, reasons): control characters and
 * bidi overrides removed, so a name can't send escape codes to your terminal or hide text.
 */
export function printable(text: string): string {
  return text.replace(/[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "");
}

// ----- device login -----

export interface DeviceStart {
  deviceCode: string;
  userCode: string;
  expiresAt: number; // ms since epoch
  intervalMs: number;
}

export async function startDeviceLogin(opts: ApiCallOptions): Promise<DeviceStart> {
  const { body } = await apiCall(opts, "POST", "/api/v1/device/start");
  if (!isObj(body)) throw bad("login answer");
  const { device_code, user_code, expires_at, interval } = body;
  if (!isStr(device_code) || !/^[A-Za-z0-9_-]{43}$/.test(device_code)) throw bad("login answer");
  if (!isStr(user_code) || !/^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(user_code)) throw bad("login code");
  const expiresAt = isStr(expires_at) ? Date.parse(expires_at) : NaN;
  if (Number.isNaN(expiresAt)) throw bad("login answer");
  // Never poll faster than every 2 s, or slower than every 30 s, whatever the server says.
  const seconds = typeof interval === "number" && Number.isFinite(interval) ? Math.min(Math.max(interval, 2), 30) : 5;
  return { deviceCode: device_code, userCode: user_code, expiresAt, intervalMs: seconds * 1000 };
}

export type DevicePoll = { status: "pending" | "expired" | "invalid" } | { status: "approved"; token: string };

export async function pollDeviceLogin(opts: ApiCallOptions, deviceCode: string): Promise<DevicePoll> {
  const { body } = await apiCall(opts, "POST", "/api/v1/device/token", { device_code: deviceCode });
  if (!isObj(body)) throw bad("login answer");
  if (body.status === "approved") {
    if (!isStr(body.token) || !isTokenShape(body.token)) throw bad("token");
    return { status: "approved", token: body.token };
  }
  if (body.status === "pending" || body.status === "expired" || body.status === "invalid") return { status: body.status };
  throw bad("login answer");
}

// ----- who am I, what can I link, log out -----

export interface WhoAmI {
  user: { id: string; name: string; email: string | null };
  token: { kind: "cli" | "agent"; prefix: string; expiresAt: string | null; project: { space: string; slug: string; name: string } | null };
}

export async function whoAmI(opts: ApiCallOptions): Promise<WhoAmI> {
  const { body } = await apiCall(opts, "GET", "/api/v1/whoami");
  if (!isObj(body) || !isObj(body.user) || !isObj(body.token)) throw bad("account answer");
  const u = body.user;
  const t = body.token;
  if (!isStr(u.id) || !isStr(u.name) || !(u.email === null || isStr(u.email))) throw bad("account answer");
  if ((t.kind !== "cli" && t.kind !== "agent") || !isStr(t.prefix, 20)) throw bad("account answer");
  let project: WhoAmI["token"]["project"] = null;
  if (isObj(t.project)) {
    const p = t.project;
    if (!isValidSlug(p.space) || !isValidSlug(p.slug) || !isStr(p.name)) throw bad("account answer");
    project = { space: p.space, slug: p.slug, name: printable(p.name) };
  }
  return {
    user: { id: u.id, name: printable(u.name), email: u.email === null ? null : printable(u.email) },
    token: { kind: t.kind, prefix: printable(t.prefix), expiresAt: isStr(t.expires_at) ? t.expires_at : null, project },
  };
}

export interface SpaceList {
  spaces: { slug: string; name: string; kind: "work" | "personal"; projects: { slug: string; name: string }[] }[];
}

export async function listProjects(opts: ApiCallOptions): Promise<SpaceList> {
  const { body } = await apiCall(opts, "GET", "/api/v1/projects");
  if (!isObj(body) || !Array.isArray(body.spaces)) throw bad("project list");
  const spaces: SpaceList["spaces"] = [];
  for (const s of body.spaces as unknown[]) {
    if (!isObj(s) || !isValidSlug(s.slug) || !isStr(s.name) || (s.kind !== "work" && s.kind !== "personal") || !Array.isArray(s.projects)) {
      throw bad("project list");
    }
    const projects: { slug: string; name: string }[] = [];
    for (const p of s.projects as unknown[]) {
      if (!isObj(p) || !isValidSlug(p.slug) || !isStr(p.name)) throw bad("project list");
      projects.push({ slug: p.slug, name: printable(p.name) });
    }
    spaces.push({ slug: s.slug, name: printable(s.name), kind: s.kind, projects });
  }
  return { spaces };
}

/** Revokes the token in opts.token (the server revokes exactly the token that sent the request). */
export async function revokeThisToken(opts: ApiCallOptions): Promise<void> {
  await apiCall(opts, "DELETE", "/api/v1/token");
}

// ----- pull -----

export interface PullAnswer {
  project: { name: string; slug: string; space: string };
  /** The marker version: space + team + personal counters (as in the rendered file). */
  version: number;
  files: RenderedFile[];
  blocked: { title: string; layer: string; reason: string }[];
}

export async function pullRules(opts: ApiCallOptions, space: string, project: string): Promise<PullAnswer> {
  const query = `?space=${encodeURIComponent(space)}&project=${encodeURIComponent(project)}`;
  const { body } = await apiCall(opts, "GET", `/api/v1/pull${query}`);
  if (!isObj(body) || !isObj(body.project) || !isObj(body.versions) || !Array.isArray(body.files) || !Array.isArray(body.blocked)) {
    throw bad("rules answer");
  }
  const p = body.project;
  if (!isStr(p.name) || p.slug !== project || p.space !== space) throw bad("rules answer (wrong project)");
  const v = body.versions;
  const counters = [v.space, v.team, v.personal];
  if (!counters.every((n) => typeof n === "number" && Number.isSafeInteger(n) && n >= 0)) throw bad("rules version");
  const version = (counters as number[]).reduce((a, b) => a + b, 0);

  const files: RenderedFile[] = [];
  for (const f of body.files as unknown[]) {
    if (!isObj(f) || !isStr(f.path, 300) || typeof f.content !== "string") throw bad("rule file");
    files.push({ path: f.path, content: f.content }); // only the known fields
  }
  const blocked: PullAnswer["blocked"] = [];
  for (const b of body.blocked as unknown[]) {
    if (!isObj(b) || !isStr(b.title) || !isStr(b.layer, 20) || !isStr(b.reason)) throw bad("rules answer");
    blocked.push({ title: printable(b.title), layer: printable(b.layer), reason: printable(b.reason) });
  }
  return { project: { name: printable(p.name), slug: p.slug, space: p.space }, version, files, blocked };
}
