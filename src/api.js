// import { config } from "../config.js";

// // ─── Types ────────────────────────────────────────────────────────────────────
// //
// // ApiResult discriminated union:
// //   { status: "ok",        replays: RawReplay[] }
// //   { status: "ratelimit"                        }
// //   { status: "caught_up"                        }
// //   { status: "network_error", error: Error      }

// // ─── Fetch ────────────────────────────────────────────────────────────────────

// /**
//  * Calls the bonk.io replay API.
//  *
//  * Returns an ApiResult — never throws (all errors are captured as
//  * { status: "network_error" } so the scraper loop can handle them uniformly).
//  *
//  * @param {number} startingFrom  The replay ID to start fetching from.
//  * @returns {Promise<ApiResult>}
//  */
// export async function fetchReplays(startingFrom) {
//     let res;
//     try {
//         res = await fetch(config.apiUrl, {
//             method:  "POST",
//             headers: { "Content-Type": "application/x-www-form-urlencoded" },
//             body:    `version=${config.apiVersion}&startingFrom=${startingFrom}`,
//             // Give bonk.io 15 seconds to respond before we treat it as down.
//             signal:  AbortSignal.timeout(15_000),
//         });
//     } catch (err) {
//         // Network error, DNS failure, timeout, bonk.io is down, etc.
//         return { status: "network_error", error: err };
//     }

//     if (!res.ok) {
//         return {
//             status: "network_error",
//             error:  new Error(`HTTP ${res.status} ${res.statusText}`),
//         };
//     }

//     let body;
//     try {
//         body = await res.text();
//     } catch (err) {
//         return { status: "network_error", error: err };
//     }

//     // ── Parse ────────────────────────────────────────────────────────────────

//     let json;
//     try {
//         json = JSON.parse(body);
//     } catch {
//         // Bonk occasionally returns an HTML error page or empty body.
//         return {
//             status: "network_error",
//             error:  new Error(`Non-JSON response: ${body.slice(0, 120)}`),
//         };
//     }

//     if (json.r !== "success") {
//         // The API signals rate-limiting (and possibly other errors) this way.
//         console.warn("[API] Non-success response:", JSON.stringify(json).slice(0, 200));
//         return { status: "ratelimit" };
//     }

//     const replays = json.replays ?? [];

//     if (replays.length === 0) {
//         return { status: "caught_up" };
//     }

//     if (replays.length !== 10) {
//         console.warn(`[API] Expected 10 replays, got ${replays.length} — near end of data?`);
//     }

//     return { status: "ok", replays };
// }

import { config } from "../config.js";

// ─── Types ────────────────────────────────────────────────────────────────────
//
// ApiResult discriminated union:
//   { status: "ok",        replays: RawReplay[] }
//   { status: "ratelimit"                        }
//   { status: "caught_up"                        }
//   { status: "network_error", error: Error      }

// ─── Fetch ────────────────────────────────────────────────────────────────────

/**
 * Calls the bonk.io replay API, mirroring the official client's pagination
 * model (confirmed via live DevTools capture + source inspection):
 *
 *   - The real field is `offset`, not `startingFrom`. `offset` is a running
 *     count into the result stream, starting at 0 and advancing by
 *     response.replays.length after each call.
 *   - `startingFrom` is an ANCHOR replay id, not a page cursor. Omit it on
 *     the first call of a sequence; hold it fixed (= the id of the first
 *     replay returned by that first call) for every subsequent call in the
 *     same sequence, so the "page" you're walking through doesn't shift
 *     under you as new replays get inserted live.
 *
 * @param {number} offset          Running count of replays already consumed
 *                                  in this anchored sequence. 0 for a fresh
 *                                  "give me the newest replays" call.
 * @param {number|null} anchorId   Replay id to anchor to, or null for the
 *                                  first call in a fresh sequence.
 * @returns {Promise<ApiResult>}
 */
export async function fetchReplays(offset, anchorId = null) {
    const params = new URLSearchParams({
        version: String(config.apiVersion),
        offset:  String(offset),
    });
    if (anchorId != null) params.set("startingFrom", String(anchorId));

    let res;
    try {
        res = await fetch(config.apiUrl, {
            method:  "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body:    params.toString(),
            // Give bonk.io 15 seconds to respond before we treat it as down.
            signal:  AbortSignal.timeout(15_000),
        });
    } catch (err) {
        // Network error, DNS failure, timeout, bonk.io is down, etc.
        return { status: "network_error", error: err };
    }

    if (!res.ok) {
        return {
            status: "network_error",
            error:  new Error(`HTTP ${res.status} ${res.statusText}`),
        };
    }

    let body;
    try {
        body = await res.text();
    } catch (err) {
        return { status: "network_error", error: err };
    }

    // ── Parse ────────────────────────────────────────────────────────────────

    let json;
    try {
        json = JSON.parse(body);
    } catch {
        // Bonk occasionally returns an HTML error page or empty body.
        return {
            status: "network_error",
            error:  new Error(`Non-JSON response: ${body.slice(0, 120)}`),
        };
    }

    if (json.r !== "success") {
        // The API signals rate-limiting (and possibly other errors) this way.
        console.warn("[API] Non-success response:", JSON.stringify(json).slice(0, 200));
        return { status: "ratelimit" };
    }

    const replays = json.replays ?? [];

    if (replays.length === 0) {
        return { status: "caught_up" };
    }

    // NOTE: batch size is NOT confirmed to be a fixed 10 — the server-side
    // page size is unknown (see docs). Don't warn on anything but a genuine
    // empty response; just trust response.replays.length as-is.

    return { status: "ok", replays };
}