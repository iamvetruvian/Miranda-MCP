import { describe, it, expect, afterEach } from "vitest";
import http from "http";
import express from "express";
import { fork } from "child_process";
import path from "path";
import fs from "fs";
import {
  isDevPortRecoveryEnabled,
  getPidsOnPort,
  killProcessOnPort,
  ensurePortAvailable,
  listenWithPortRecovery,
} from "../../src/utils/dev-port-killer.js";

describe("Dev Port Recovery and Process Killer Helper", () => {
  const openServers: http.Server[] = [];

  afterEach(async () => {
    for (const s of openServers) {
      try {
        await new Promise<void>((resolve) => s.close(() => resolve()));
      } catch {
        // Ignore
      }
    }
    openServers.length = 0;
  });

  it("should report recovery enabled by default and disabled when DEV_PORT_RECOVERY=false", () => {
    expect(isDevPortRecoveryEnabled()).toBe(true);

    const prev = process.env.DEV_PORT_RECOVERY;
    process.env.DEV_PORT_RECOVERY = "false";
    expect(isDevPortRecoveryEnabled()).toBe(false);

    process.env.DEV_PORT_RECOVERY = prev ?? "true";
  });

  it("should safely return empty array for non-existent or invalid ports", () => {
    expect(getPidsOnPort(0)).toEqual([]);
    expect(getPidsOnPort(-1)).toEqual([]);
    expect(getPidsOnPort(NaN)).toEqual([]);
  });

  it("should never include process.pid in foreign PIDs list", async () => {
    const testPort = 59871;
    const server = http.createServer((_req, res) => res.end("ok"));
    await new Promise<void>((resolve) => server.listen(testPort, () => resolve()));
    openServers.push(server);

    const pids = getPidsOnPort(testPort);
    // Since current process owns the server, getPidsOnPort should exclude process.pid
    expect(pids).not.toContain(process.pid);
  });

  it("should find and terminate a foreign child process holding a port", async () => {
    const testPort = 59872;

    // Create a temporary child script that holds the port
    const childScript = path.resolve(process.cwd(), "tests/unit/test-port-child.mjs");
    fs.writeFileSync(
      childScript,
      `
import http from "http";
const server = http.createServer((req, res) => res.end("child running"));
server.listen(${testPort}, () => {
  if (process.send) process.send("listening");
});
setInterval(() => {}, 5000);
      `
    );

    try {
      const child = fork(childScript, [], { stdio: ["ignore", "pipe", "pipe", "ipc"] });

      // Wait for child to start listening
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Child timeout")), 3000);
        child.on("message", (msg) => {
          if (msg === "listening") {
            clearTimeout(timeout);
            resolve();
          }
        });
      });

      // Confirm child PID is detected
      const pids = getPidsOnPort(testPort);
      expect(pids).toContain(child.pid);

      // Kill the process on the port
      const killed = killProcessOnPort(testPort, true);
      expect(killed).toBe(true);

      // Verify port is now free
      const pidsAfter = getPidsOnPort(testPort);
      expect(pidsAfter).toEqual([]);
    } finally {
      if (fs.existsSync(childScript)) {
        fs.unlinkSync(childScript);
      }
    }
  });

  it("should recover automatically with listenWithPortRecovery when port is occupied by child process", async () => {
    const testPort = 59873;

    // Start a child process holding testPort
    const childScript = path.resolve(process.cwd(), "tests/unit/test-port-collision.mjs");
    fs.writeFileSync(
      childScript,
      `
import http from "http";
const server = http.createServer((req, res) => res.end("old instance"));
server.listen(${testPort}, () => {
  if (process.send) process.send("ready");
});
setInterval(() => {}, 5000);
      `
    );

    try {
      const child = fork(childScript, [], { stdio: ["ignore", "pipe", "pipe", "ipc"] });

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Child timeout")), 3000);
        child.on("message", (msg) => {
          if (msg === "ready") {
            clearTimeout(timeout);
            resolve();
          }
        });
      });

      // Now create Express app and listen with port recovery
      const app = express();
      app.get("/ping", (_req, res) => res.send("pong-new-instance"));

      const server = await new Promise<http.Server>((resolve) => {
        const s = listenWithPortRecovery(app, testPort, () => {
          resolve(s);
        });
      });
      openServers.push(server);

      // Test that our new server handles requests
      const response = await fetch(`http://127.0.0.1:${testPort}/ping`);
      const body = await response.text();
      expect(body).toBe("pong-new-instance");
    } finally {
      if (fs.existsSync(childScript)) {
        fs.unlinkSync(childScript);
      }
    }
  });
});
