// Real-road route building.
//
// Downloads the walkable/runnable street network around a point straight from
// OpenStreetMap (Overpass API, free, no key), turns it into an intersection
// graph and searches *that graph* for loops / out-and-backs of a target
// distance. Because every metre of the answer is an existing OSM way, routes
// follow real streets, parks and footpaths instead of being a geometric circle
// draped over the map.
//
// Everything here is plain data + pure-ish functions so the UI can stay thin.

// Public Overpass mirrors, tried in order — any one of them can be busy or
// down, so the fetch fails over instead of giving up.
const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];

// Cost multiplier per OSM highway type — lower is nicer to run on. Multiplied
// by the segment length, so the router trades a little distance for quiet ways.
const WAY_COST = {
  footway: 0.75, path: 0.8, pedestrian: 0.75, cycleway: 0.85, track: 0.9,
  bridleway: 1, steps: 6,
  living_street: 0.95, residential: 1, unclassified: 1.05, service: 1.15,
  road: 1.3, tertiary: 1.5, tertiary_link: 1.5,
  secondary: 2.6, secondary_link: 2.6, primary: 4, primary_link: 4,
};
const DEFAULT_COST = 1.4;
// Ways that are pleasant, car-free running (used for the "on paths" stat).
const PATHY = new Set(["footway", "path", "pedestrian", "cycleway", "track", "bridleway", "steps", "living_street"]);
const BUSY = new Set(["secondary", "secondary_link", "primary", "primary_link", "tertiary", "tertiary_link"]);

export function haversineKm(a, b) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

// Compass-ish bearing in radians from a to b (0 = north, clockwise).
function bearingOf(a, b) {
  const dLat = b.lat - a.lat;
  const dLng = (b.lng - a.lng) * Math.cos((a.lat * Math.PI) / 180);
  return Math.atan2(dLng, dLat);
}

function angleDiff(x, y) {
  let d = x - y;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

// ---------------------------------------------------------------- network ---

const netCache = new Map();

function overpassQuery(lat, lng, radiusM) {
  return `[out:json][timeout:30];way(around:${Math.round(radiusM)},${lat.toFixed(5)},${lng.toFixed(5)})` +
    `["highway"]` +
    `["highway"!~"^(motorway|motorway_link|trunk|trunk_link|construction|proposed|raceway|bus_guideway|corridor|elevator|platform)$"]` +
    `["foot"!~"^(no|private)$"]["access"!~"^(private|no)$"];out geom;`;
}

async function fetchOverpass(lat, lng, radiusM, signal) {
  let lastErr;
  for (const url of OVERPASS_ENDPOINTS) {
    try {
      const res = await fetch(url, {
        method: "POST",
        body: "data=" + encodeURIComponent(overpassQuery(lat, lng, radiusM)),
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        signal,
      });
      if (!res.ok) throw new Error(`overpass ${res.status}`);
      const json = await res.json();
      if (json && Array.isArray(json.elements) && json.elements.length) return json.elements;
      throw new Error("empty overpass reply");
    } catch (e) {
      if (signal && signal.aborted) throw e;
      lastErr = e;
    }
  }
  throw lastErr || new Error("no overpass endpoint reachable");
}

// Turn raw OSM ways into a graph whose nodes are junctions/way ends and whose
// edges carry the full polyline between them.
function buildGraph(elements) {
  const seen = new Map(); // node id -> times referenced
  const ways = [];
  for (const el of elements) {
    if (el.type !== "way" || !el.nodes || !el.geometry) continue;
    if (el.nodes.length !== el.geometry.length || el.nodes.length < 2) continue;
    const kind = (el.tags && el.tags.highway) || "road";
    ways.push({ ids: el.nodes, geom: el.geometry.map((g) => ({ lat: g.lat, lng: g.lon })), kind });
    el.nodes.forEach((id, i) => {
      const prev = seen.get(id) || 0;
      // way ends always split, interior nodes only when shared by two ways
      seen.set(id, prev + (i === 0 || i === el.nodes.length - 1 ? 2 : 1));
    });
  }

  const nodes = new Map();
  const adj = new Map();
  const edges = [];
  const addAdj = (from, entry) => {
    const list = adj.get(from);
    if (list) list.push(entry);
    else adj.set(from, [entry]);
  };

  for (const way of ways) {
    let startIdx = 0;
    for (let i = 1; i < way.ids.length; i++) {
      const isSplit = i === way.ids.length - 1 || (seen.get(way.ids[i]) || 0) > 1;
      if (!isSplit) continue;
      const a = way.ids[startIdx];
      const b = way.ids[i];
      const geom = way.geom.slice(startIdx, i + 1);
      startIdx = i;
      if (a === b || geom.length < 2) continue;
      let len = 0;
      for (let k = 1; k < geom.length; k++) len += haversineKm(geom[k - 1], geom[k]);
      if (!len) continue;
      const eid = edges.length;
      const cost = len * (WAY_COST[way.kind] ?? DEFAULT_COST);
      edges.push({ a, b, len, cost, kind: way.kind, geom });
      nodes.set(a, geom[0]);
      nodes.set(b, geom[geom.length - 1]);
      addAdj(a, { to: b, eid, len, cost, kind: way.kind, geom });
      addAdj(b, { to: a, eid, len, cost, kind: way.kind, geom: geom.slice().reverse() });
    }
  }
  return keepLargestComponent({ nodes, adj, edges });
}

// Drop disconnected islands so the router never strands itself.
function keepLargestComponent(g) {
  const comp = new Map();
  let best = -1;
  let bestSize = 0;
  let id = 0;
  for (const start of g.nodes.keys()) {
    if (comp.has(start)) continue;
    const stack = [start];
    comp.set(start, id);
    let size = 0;
    while (stack.length) {
      const n = stack.pop();
      size++;
      for (const e of g.adj.get(n) || []) {
        if (!comp.has(e.to)) { comp.set(e.to, id); stack.push(e.to); }
      }
    }
    if (size > bestSize) { bestSize = size; best = id; }
    id++;
  }
  if (bestSize === g.nodes.size) return g;
  const nodes = new Map();
  const adj = new Map();
  for (const [n, pt] of g.nodes) {
    if (comp.get(n) !== best) continue;
    nodes.set(n, pt);
    adj.set(n, g.adj.get(n) || []);
  }
  return { nodes, adj, edges: g.edges };
}

/**
 * Load (and memoise) the runnable network around a point.
 * @param {{lat:number,lng:number}} center
 * @param {number} radiusM how far around the centre to download
 */
export async function loadNetwork(center, radiusM, { signal } = {}) {
  const key = `${center.lat.toFixed(3)},${center.lng.toFixed(3)},${Math.round(radiusM / 250)}`;
  const hit = netCache.get(key);
  if (hit) return hit;
  const elements = await fetchOverpass(center.lat, center.lng, radiusM, signal);
  const graph = buildGraph(elements);
  if (graph.nodes.size < 8) throw new Error("no roads found around here");
  netCache.set(key, graph);
  return graph;
}

export function nearestNode(graph, pt) {
  let best = null;
  let bestD = Infinity;
  for (const [id, p] of graph.nodes) {
    const d = (p.lat - pt.lat) ** 2 + ((p.lng - pt.lng) * Math.cos((pt.lat * Math.PI) / 180)) ** 2;
    if (d < bestD) { bestD = d; best = id; }
  }
  return best;
}

// ------------------------------------------------------------------ paths ---

class Heap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(item) {
    const a = this.a;
    a.push(item);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].k <= a[i].k) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop() {
    const a = this.a;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let s = i;
        if (l < a.length && a[l].k < a[s].k) s = l;
        if (r < a.length && a[r].k < a[s].k) s = r;
        if (s === i) break;
        [a[s], a[i]] = [a[i], a[s]];
        i = s;
      }
    }
    return top;
  }
}

/**
 * Dijkstra over the weighted graph.
 * @param {object} graph
 * @param {number} from start node id
 * @param {(node:number, dist:number)=>boolean} [isGoal] stop when this returns true
 * @param {{penalty?:Set<number>, maxKm?:number}} [opts] `penalty` edge ids cost 4× (used to avoid retracing)
 * @returns {{dist:Map, prev:Map, reached:number|null}}
 */
export function dijkstra(graph, from, isGoal, opts = {}) {
  const { penalty, maxKm = Infinity } = opts;
  const cost = new Map([[from, 0]]);
  const dist = new Map([[from, 0]]);
  const prev = new Map();
  const done = new Set();
  const heap = new Heap();
  heap.push({ k: 0, n: from });
  while (heap.size) {
    const { n } = heap.pop();
    if (done.has(n)) continue;
    done.add(n);
    if (isGoal && isGoal(n, dist.get(n))) return { dist, prev, reached: n };
    if (dist.get(n) > maxKm) continue;
    for (const e of graph.adj.get(n) || []) {
      const c = cost.get(n) + e.cost * (penalty && penalty.has(e.eid) ? 4 : 1);
      if (c < (cost.get(e.to) ?? Infinity)) {
        cost.set(e.to, c);
        dist.set(e.to, dist.get(n) + e.len);
        prev.set(e.to, { from: n, e });
        heap.push({ k: c, n: e.to });
      }
    }
  }
  return { dist, prev, reached: null };
}

// Walk a Dijkstra `prev` chain back into an ordered list of adjacency entries.
function tracePath(prev, from, to) {
  const steps = [];
  let cur = to;
  while (cur !== from) {
    const p = prev.get(cur);
    if (!p) return null;
    steps.push(p.e);
    cur = p.from;
  }
  return steps.reverse();
}

// Concatenate edge geometries into one polyline (dropping duplicated joins).
function stepsToPoints(steps, startPt) {
  const pts = [startPt];
  for (const s of steps) {
    for (let i = 1; i < s.geom.length; i++) pts.push(s.geom[i]);
  }
  return pts;
}

function summarise(steps, points) {
  let km = 0, pathKm = 0, busyKm = 0;
  const used = new Map();
  for (const s of steps) {
    km += s.len;
    used.set(s.eid, (used.get(s.eid) || 0) + 1);
  }
  let repeatKm = 0;
  const byId = new Map();
  for (const s of steps) byId.set(s.eid, s);
  for (const [eid, n] of used) {
    const s = byId.get(eid);
    if (n > 1) repeatKm += s.len * (n - 1);
  }
  for (const s of steps) {
    if (PATHY.has(s.kind)) pathKm += s.len;
    if (BUSY.has(s.kind)) busyKm += s.len;
  }
  return {
    points,
    km,
    pathPct: km ? Math.round((pathKm / km) * 100) : 0,
    busyPct: km ? Math.round((busyKm / km) * 100) : 0,
    repeatPct: km ? Math.round((repeatKm / km) * 100) : 0,
  };
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Grow a loop out of the real network: a randomised walk that heads away from
 * the start, curls consistently in one direction, then is closed with a
 * shortest path home. Many attempts are scored on distance error, how much of
 * the route doubles back, and road quality; the best one wins.
 *
 * @returns {{points:Array,km:number,pathPct:number,busyPct:number,repeatPct:number}}
 */
export function buildLoop(graph, startNode, targetKm, opts = {}) {
  const { attempts = 90, timeBudgetMs = 4000, seed = Date.now(), quiet = true } = opts;
  const rng = mulberry32(seed);
  const startPt = graph.nodes.get(startNode);
  const t0 = Date.now();
  let best = null;
  let bestScore = Infinity;

  for (let attempt = 0; attempt < attempts; attempt++) {
    if (Date.now() - t0 > timeBudgetMs) break;
    const outBearing = rng() * 2 * Math.PI;
    const spin = rng() < 0.5 ? 1 : -1;      // curl left or right consistently
    const steps = [];
    const usedEdges = new Map();
    let node = startNode;
    let travelled = 0;
    let lastEid = -1;
    let stuck = false;

    while (travelled < targetKm * 0.62) {
      const here = graph.nodes.get(node);
      const cands = (graph.adj.get(node) || []).filter((e) => e.eid !== lastEid);
      const pool = cands.length ? cands : graph.adj.get(node) || [];
      if (!pool.length) { stuck = true; break; }
      // Desired heading: swing steadily around the start point so the walk
      // traces an organic circuit rather than a straight spike.
      const frac = Math.min(1, travelled / (targetKm * 0.62));
      const want = outBearing + spin * frac * Math.PI * 0.9;
      let total = 0;
      const weights = pool.map((e) => {
        const dest = graph.nodes.get(e.to);
        const align = Math.cos(angleDiff(bearingOf(here, dest), want));
        const reuse = usedEdges.get(e.eid) ? 0.06 : 1;
        const quality = quiet ? (e.len / e.cost) : 1;   // 1/(cost multiplier)
        const w = Math.max(0.02, (1.15 + align)) ** 2.6 * reuse * quality ** 1.6;
        total += w;
        return w;
      });
      let pick = rng() * total;
      let chosen = pool[pool.length - 1];
      for (let i = 0; i < pool.length; i++) {
        pick -= weights[i];
        if (pick <= 0) { chosen = pool[i]; break; }
      }
      if (travelled + chosen.len + haversineKm(graph.nodes.get(chosen.to), startPt) > targetKm * 1.35) break;
      steps.push(chosen);
      usedEdges.set(chosen.eid, (usedEdges.get(chosen.eid) || 0) + 1);
      travelled += chosen.len;
      lastEid = chosen.eid;
      node = chosen.to;
      if (steps.length > 400) break;
    }
    if (stuck || !steps.length || node === startNode) continue;

    // Close the loop with a shortest path home that avoids what we just ran.
    const penalty = new Set(usedEdges.keys());
    const { prev, reached } = dijkstra(graph, node, (n) => n === startNode, { penalty });
    if (reached == null) continue;
    const back = tracePath(prev, node, startNode);
    if (!back) continue;
    const all = steps.concat(back);
    const sum = summarise(all, stepsToPoints(all, startPt));
    if (sum.km < targetKm * 0.55 || sum.km > targetKm * 1.6) continue;

    const err = Math.abs(sum.km - targetKm) / targetKm;
    const score = err * 4 + (sum.repeatPct / 100) * 2.2 + (sum.busyPct / 100) * (quiet ? 1.2 : 0.3) - (sum.pathPct / 100) * 0.4;
    if (score < bestScore) { bestScore = score; best = sum; }
    if (err < 0.05 && sum.repeatPct < 12) break; // good enough, stop early
  }
  if (!best) throw new Error("couldn't find a loop on the roads here");
  return best;
}

/**
 * Out-and-back on real roads: run out along the nicest path until roughly half
 * the target, then return the same way (a genuine out-and-back) — the return
 * leg is re-routed only if a distinct road is barely longer.
 */
export function buildOutBack(graph, startNode, targetKm, opts = {}) {
  const { quiet = true } = opts;
  const half = targetKm / 2;
  const startPt = graph.nodes.get(startNode);
  const { dist, prev } = dijkstra(graph, startNode, null, { maxKm: half * 1.25 });

  // Pick the reachable node whose distance is closest to half the target,
  // preferring ones that are genuinely far away (a real destination, not a
  // wiggle round the block).
  let turn = null;
  let bestScore = Infinity;
  for (const [node, d] of dist) {
    if (d < half * 0.7 || d > half * 1.3) continue;
    const straight = haversineKm(startPt, graph.nodes.get(node));
    const score = Math.abs(d - half) / half + (1 - Math.min(1, straight / (half * 0.55))) * 0.8;
    if (score < bestScore) { bestScore = score; turn = node; }
  }
  if (turn == null) throw new Error("no road far enough for that distance");
  const out = tracePath(prev, startNode, turn);
  if (!out) throw new Error("no route out");

  // Try a different way home; keep it only if it isn't a big detour.
  let back = null;
  const penalty = new Set(out.map((s) => s.eid));
  const alt = dijkstra(graph, turn, (n) => n === startNode, { penalty });
  if (alt.reached != null) {
    const altSteps = tracePath(alt.prev, turn, startNode);
    const outKm = out.reduce((a, s) => a + s.len, 0);
    const altKm = altSteps ? altSteps.reduce((a, s) => a + s.len, 0) : Infinity;
    if (altSteps && altKm < outKm * 1.25) back = altSteps;
  }
  if (!back) {
    back = out.slice().reverse().map((s) => {
      const rev = (graph.adj.get(s.to) || []).find((e) => e.eid === s.eid);
      return rev || s;
    });
  }
  const all = out.concat(back);
  const sum = summarise(all, stepsToPoints(all, startPt));
  sum.quiet = quiet;
  return sum;
}

/** Shortest sensible running path between two points, following roads. */
export function routeBetween(graph, fromNode, toNode) {
  const { prev, reached } = dijkstra(graph, fromNode, (n) => n === toNode);
  if (reached == null) throw new Error("no road connects those points");
  const steps = tracePath(prev, fromNode, toNode);
  if (!steps) throw new Error("no road connects those points");
  return summarise(steps, stepsToPoints(steps, graph.nodes.get(fromNode)));
}

/**
 * Snap a list of tapped waypoints onto the road network, leg by leg.
 * Returns the joined geometry plus the true on-road distance.
 */
export function snapWaypoints(graph, wpts) {
  const ids = wpts.map((p) => nearestNode(graph, p));
  let points = [];
  let steps = [];
  for (let i = 1; i < ids.length; i++) {
    if (ids[i] === ids[i - 1]) continue;
    const { prev, reached } = dijkstra(graph, ids[i - 1], (n) => n === ids[i]);
    if (reached == null) throw new Error("those points aren't connected by road");
    const leg = tracePath(prev, ids[i - 1], ids[i]);
    if (!leg) throw new Error("those points aren't connected by road");
    const legPts = stepsToPoints(leg, graph.nodes.get(ids[i - 1]));
    points = points.length ? points.concat(legPts.slice(1)) : legPts;
    steps = steps.concat(leg);
  }
  if (!points.length) throw new Error("need two points on a road");
  return summarise(steps, points);
}

/**
 * How much network to download for a target distance. A loop of L km fits in a
 * circle of radius ~L/6, an out-and-back needs half the distance as the crow
 * flies — downloading only what's needed keeps Overpass fast.
 */
export function radiusForTarget(targetKm, mode = "loop") {
  const factor = mode === "outback" ? 620 : 380;
  return Math.min(6000, Math.max(800, targetKm * factor));
}
