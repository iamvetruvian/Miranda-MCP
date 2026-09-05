/**
 * [DEV / TESTING ONLY - TEMPORARY HELPER]
 * Utility to detect and terminate any existing process occupying a target TCP port,
 * and provide safe server listen wrappers that catch EADDRINUSE/ECONNREFUSED errors,
 * kill the offending process, and retry binding.
 *
 * This helps avoid port collisions during agent restarts and testing sessions.
 *
 * TO REMOVE LATER:
 * 1. Delete this file (`src/utils/dev-port-killer.ts`).
 * 2. Revert `listenWithPortRecovery` calls back to standard `app.listen` across server files.
 */

import { execSync } from "child_process";
import http from "http";
import express from "express";

/**
 * Check if dev port recovery is enabled.
 * Default is enabled unless DEV_PORT_RECOVERY is explicitly set to "false".
 */
export function isDevPortRecoveryEnabled(): boolean {
  return process.env.DEV_PORT_RECOVERY !== "false";
}

/**
 * Synchronously sleeps for the given number of milliseconds.
 */
function sleepSync(ms: number): void {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    // busy wait for short duration socket release
  }
}

/**
 * Finds all PIDs currently listening on or connected to the specified TCP port.
 */
export function getPidsOnPort(port: number): number[] {
  if (!port || isNaN(port) || port <= 0) return [];

  const pids = new Set<number>();

  if (process.platform === "win32") {
    try {
      const output = execSync(`netstat -ano | findstr :${port}`, {
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      for (const line of output.split("\n")) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 5 && parts[1].includes(`:${port}`)) {
          const pid = parseInt(parts[parts.length - 1], 10);
          if (!isNaN(pid) && pid > 0 && pid !== process.pid) {
            pids.add(pid);
          }
        }
      }
    } catch {
      // No process found or command not available
    }
  } else {
    // Linux / macOS / Unix: try lsof first, then fuser, then ss
    try {
      const lsofOut = execSync(`lsof -ti :${port}`, {
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      for (const pidStr of lsofOut.trim().split(/\s+/)) {
        const pid = parseInt(pidStr, 10);
        if (!isNaN(pid) && pid > 0 && pid !== process.pid) {
          pids.add(pid);
        }
      }
    } catch {
      // lsof returned non-zero (no process or not found), try fuser
      try {
        const fuserOut = execSync(`fuser ${port}/tcp 2>/dev/null`, {
          encoding: "utf-8",
          stdio: ["ignore", "pipe", "ignore"],
        });
        for (const pidStr of fuserOut.trim().split(/\s+/)) {
          const pid = parseInt(pidStr.replace(/[^0-9]/g, ""), 10);
          if (!isNaN(pid) && pid > 0 && pid !== process.pid) {
            pids.add(pid);
          }
        }
      } catch {
        // fuser returned non-zero, try ss
        try {
          const ssOut = execSync(`ss -lptn "sport = :${port}" 2>/dev/null`, {
            encoding: "utf-8",
            stdio: ["ignore", "pipe", "ignore"],
          });
          const matches = ssOut.match(/pid=(\d+)/g);
          if (matches) {
            for (const m of matches) {
              const pid = parseInt(m.replace("pid=", ""), 10);
              if (!isNaN(pid) && pid > 0 && pid !== process.pid) {
                pids.add(pid);
              }
            }
          }
        } catch {
          // No process found
        }
      }
    }
  }

  return Array.from(pids);
}

/**
 * Terminates any foreign process running on the specified TCP port.
 * Returns true if one or more processes were killed, false otherwise.
 */
export function killProcessOnPort(port: number, silent: boolean = false): boolean {
  if (!isDevPortRecoveryEnabled()) return false;
  if (!port || isNaN(port) || port <= 0) return false;

  const pids = getPidsOnPort(port);
  let killed = false;

  if (pids.length > 0) {
    for (const pid of pids) {
      if (pid === process.pid) continue; // Safety: never kill self
      try {
        process.kill(pid, "SIGKILL");
        killed = true;
      } catch {
        // Might already be dying or owned by another user; try fuser fallback on Linux
        if (process.platform !== "win32") {
          try {
            execSync(`fuser -k -9 ${port}/tcp 2>/dev/null`, { stdio: "ignore" });
            killed = true;
          } catch {
            // Ignore
          }
        }
      }
    }

    if (killed && !silent) {
      console.error(`[MerchantMCP-DevPortKiller] 🧹 Terminated stale process on port ${port} (PID(s): ${pids.join(", ")})`);
    }

    // Allow the operating system kernel a brief window to release the TCP socket
    sleepSync(150);
  }

  return killed;
}

/**
 * Proactively ensures that the given port is free by killing any occupying process.
 */
export function ensurePortAvailable(port: number): void {
  if (!isDevPortRecoveryEnabled()) return;
  killProcessOnPort(port);
}

/**
 * Starts an Express app or HTTP server on `port`, with automatic retry & process termination
 * if an EADDRINUSE or ECONNREFUSED error occurs during binding.
 */
export function listenWithPortRecovery(
  appOrServer: express.Express | http.Server,
  port: number,
  listeningCallback?: () => void
): http.Server {
  // Proactively free the port before initial listen
  if (isDevPortRecoveryEnabled()) {
    ensurePortAvailable(port);
  }

  let server: http.Server;
  if (typeof (appOrServer as express.Express).listen === "function" && !(appOrServer instanceof http.Server)) {
    // It's an Express app
    server = (appOrServer as express.Express).listen(port, listeningCallback);
  } else {
    // It's an http.Server
    server = appOrServer as http.Server;
    server.listen(port, listeningCallback);
  }

  if (isDevPortRecoveryEnabled()) {
    let retries = 0;
    const maxRetries = 3;

    server.on("error", (err: any) => {
      if ((err.code === "EADDRINUSE" || err.code === "ECONNREFUSED") && retries < maxRetries) {
        retries++;
        console.error(
          `[MerchantMCP-DevPortKiller] ⚠️ Port ${port} collision detected (${err.code}). Attempting force recovery (retry ${retries}/${maxRetries})...`
        );
        killProcessOnPort(port);

        setTimeout(() => {
          try {
            server.close(() => {
              server.listen(port, listeningCallback);
            });
          } catch {
            server.listen(port, listeningCallback);
          }
        }, 300);
      } else {
        console.error(`[MerchantMCP-DevPortKiller] Server error on port ${port}:`, err);
      }
    });
  } else {
    // Without recovery, a failed bind must not crash the whole MCP stdio server:
    // another instance (e.g. from a concurrent session) may already own the port.
    server.on("error", (err: any) => {
      if (err && err.code === "EADDRINUSE") {
        console.error(
          `[MerchantMCP-DevPortKiller] Port ${port} already in use; continuing without owning this listener (another instance is serving it).`
        );
      } else {
        console.error(`[MerchantMCP-DevPortKiller] Server error on port ${port}:`, err);
      }
    });
  }

  return server;
}
