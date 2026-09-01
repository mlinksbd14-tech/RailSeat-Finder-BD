const fs = require('fs');
const path = require('path');

// Load raw BD railway ways (10,215 ways, 91,575 coords)
let nodes = [];
let adj = [];
const grid = new Map();

function initRailGraph() {
  const waysFile = path.join(__dirname, '..', 'data', 'bd_rail_ways_compact.json');
  let ways = null;

  if (fs.existsSync(waysFile)) {
    try {
      ways = JSON.parse(fs.readFileSync(waysFile, 'utf8'));
    } catch (e) {}
  }

  if (!ways) {
    const fallbackWays = 'C:/Users/User/.gemini/antigravity/brain/98b4a127-33b6-4fdc-bcf8-36822ae71cb7/scratch/bd_rail_ways.json';
    if (fs.existsSync(fallbackWays)) {
      try {
        ways = JSON.parse(fs.readFileSync(fallbackWays, 'utf8'));
      } catch (e) {}
    }
  }

  if (!ways) {
    console.warn('[RailRouter] Railway track geometry source not found');
    return;
  }

  function findOrCreateNode(lat, lon) {
    const gx = Math.floor(lat * 2000);
    const gy = Math.floor(lon * 2000);

    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const k = `${gx + dx},${gy + dy}`;
        const cell = grid.get(k);
        if (cell) {
          for (const idx of cell) {
            const pt = nodes[idx];
            if (Math.hypot(pt[0] - lat, pt[1] - lon) < 0.00008) {
              return idx;
            }
          }
        }
      }
    }

    const idx = nodes.length;
    nodes.push([lat, lon]);
    adj.push([]);
    const k = `${gx},${gy}`;
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(idx);
    return idx;
  }

  ways.forEach(w => {
    const geom = w.geometry || w;
    if (geom && geom.length > 1) {
      let prevIdx = null;
      for (let i = 0; i < geom.length; i++) {
        const p = geom[i];
        const lat = p.lat !== undefined ? p.lat : p[0];
        const lon = p.lon !== undefined ? p.lon : (p.lng !== undefined ? p.lng : p[1]);
        if (lat < 20.5 || lat > 26.8 || lon < 88.0 || lon > 92.8) continue;
        const currIdx = findOrCreateNode(lat, lon);
        if (prevIdx !== null && prevIdx !== currIdx) {
          const p1 = nodes[prevIdx];
          const p2 = nodes[currIdx];
          const dist = Math.hypot(p1[0] - p2[0], p1[1] - p2[1]);
          adj[prevIdx].push({ to: currIdx, dist });
          adj[currIdx].push({ to: prevIdx, dist });
        }
        prevIdx = currIdx;
      }
    }
  });

  // Bridge small dead-ends (< 100m)
  for (let i = 0; i < nodes.length; i++) {
    if (adj[i].length === 1) {
      const pt1 = nodes[i];
      const gx = Math.floor(pt1[0] * 2000);
      const gy = Math.floor(pt1[1] * 2000);
      for (let dx = -2; dx <= 2; dx++) {
        for (let dy = -2; dy <= 2; dy++) {
          const cell = grid.get(`${gx + dx},${gy + dy}`);
          if (cell) {
            for (const j of cell) {
              if (i !== j) {
                const pt2 = nodes[j];
                const d = Math.hypot(pt1[0] - pt2[0], pt1[1] - pt2[1]);
                if (d > 0 && d < 0.001) {
                  adj[i].push({ to: j, dist: d });
                  adj[j].push({ to: i, dist: d });
                }
              }
            }
          }
        }
      }
    }
  }

  console.log(`[RailRouter] Initialized continuous rail graph with ${nodes.length} nodes`);
}

initRailGraph();

function findNearestNode(lat, lon) {
  const gx = Math.floor(lat * 2000);
  const gy = Math.floor(lon * 2000);
  let bestIdx = -1;
  let minD = Infinity;

  for (let r = 0; r <= 30; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const cell = grid.get(`${gx + dx},${gy + dy}`);
        if (cell) {
          for (const idx of cell) {
            const pt = nodes[idx];
            const d = Math.hypot(pt[0] - lat, pt[1] - lon);
            if (d < minD) {
              minD = d;
              bestIdx = idx;
            }
          }
        }
      }
    }
    if (bestIdx !== -1 && minD < 0.04) break;
  }
  return bestIdx;
}

function perpendicularDistance(pt, lineStart, lineEnd) {
  const dx = lineEnd[1] - lineStart[1];
  const dy = lineEnd[0] - lineStart[0];
  const mag = Math.hypot(dx, dy);
  if (mag === 0) return Math.hypot(pt[0] - lineStart[0], pt[1] - lineStart[1]);
  return Math.abs(dy * pt[1] - dx * pt[0] + lineEnd[1] * lineStart[0] - lineEnd[0] * lineStart[1]) / mag;
}

function rdpSimplify(points, epsilon = 0.00004) {
  if (points.length <= 2) return points;
  let maxDist = 0;
  let index = 0;
  const end = points.length - 1;
  for (let i = 1; i < end; i++) {
    const d = perpendicularDistance(points[i], points[0], points[end]);
    if (d > maxDist) {
      maxDist = d;
      index = i;
    }
  }
  if (maxDist > epsilon) {
    const rec1 = rdpSimplify(points.slice(0, index + 1), epsilon);
    const rec2 = rdpSimplify(points.slice(index), epsilon);
    return rec1.slice(0, rec1.length - 1).concat(rec2);
  } else {
    return [points[0], points[end]];
  }
}

class MinHeap {
  constructor(fScore) {
    this.data = [];
    this.fScore = fScore;
  }
  push(idx) {
    this.data.push(idx);
    this._up(this.data.length - 1);
  }
  pop() {
    if (this.data.length === 0) return -1;
    const top = this.data[0];
    const bottom = this.data.pop();
    if (this.data.length > 0) {
      this.data[0] = bottom;
      this._down(0);
    }
    return top;
  }
  _up(i) {
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.fScore[this.data[i]] < this.fScore[this.data[p]]) {
        const t = this.data[i];
        this.data[i] = this.data[p];
        this.data[p] = t;
        i = p;
      } else break;
    }
  }
  _down(i) {
    const len = this.data.length;
    while ((i << 1) + 1 < len) {
      let left = (i << 1) + 1;
      let right = left + 1;
      let best = i;
      if (this.fScore[this.data[left]] < this.fScore[this.data[best]]) best = left;
      if (right < len && this.fScore[this.data[right]] < this.fScore[this.data[best]]) best = right;
      if (best !== i) {
        const t = this.data[i];
        this.data[i] = this.data[best];
        this.data[best] = t;
        i = best;
      } else break;
    }
  }
  size() { return this.data.length; }
}

const memoryCurveCache = new Map();

function solveTrackBetweenCoords(startCoord, endCoord) {
  if (!startCoord || !endCoord || (startCoord[0] === endCoord[0] && startCoord[1] === endCoord[1])) {
    return [startCoord, endCoord];
  }

  const cacheKey = `${startCoord[0].toFixed(3)},${startCoord[1].toFixed(3)}->${endCoord[0].toFixed(3)},${endCoord[1].toFixed(3)}`;
  if (memoryCurveCache.has(cacheKey)) {
    return memoryCurveCache.get(cacheKey);
  }

  const startIdx = findNearestNode(startCoord[0], startCoord[1]);
  const endIdx = findNearestNode(endCoord[0], endCoord[1]);

  if (startIdx === -1 || endIdx === -1 || startIdx === endIdx) {
    return [startCoord, endCoord];
  }

  const targetPt = nodes[endIdx];
  const gScore = new Float64Array(nodes.length).fill(Infinity);
  const cameFrom = new Int32Array(nodes.length).fill(-1);
  const fScore = new Float64Array(nodes.length).fill(Infinity);
  const inOpenSet = new Uint8Array(nodes.length);
  const closedSet = new Uint8Array(nodes.length);

  gScore[startIdx] = 0;
  fScore[startIdx] = Math.hypot(nodes[startIdx][0] - targetPt[0], nodes[startIdx][1] - targetPt[1]);

  const heap = new MinHeap(fScore);
  heap.push(startIdx);
  inOpenSet[startIdx] = 1;

  let iterations = 0;
  while (heap.size() > 0 && iterations < 95000) {
    iterations++;
    const current = heap.pop();
    inOpenSet[current] = 0;

    if (current === endIdx) {
      const path = [];
      let curr = endIdx;
      while (curr !== -1) {
        path.unshift(nodes[curr]);
        curr = cameFrom[curr];
      }
      const simplified = rdpSimplify(path, 0.00004);
      const res = simplified.map(p => [Math.round(p[0] * 10000) / 10000, Math.round(p[1] * 10000) / 10000]);
      memoryCurveCache.set(cacheKey, res);
      return res;
    }

    closedSet[current] = 1;

    const neighbors = adj[current];
    for (let e = 0; e < neighbors.length; e++) {
      const edge = neighbors[e];
      const neighborIdx = edge.to;
      if (closedSet[neighborIdx]) continue;

      const tentativeG = gScore[current] + edge.dist;
      if (tentativeG < gScore[neighborIdx]) {
        cameFrom[neighborIdx] = current;
        gScore[neighborIdx] = tentativeG;
        const h = Math.hypot(nodes[neighborIdx][0] - targetPt[0], nodes[neighborIdx][1] - targetPt[1]);
        fScore[neighborIdx] = tentativeG + h * 1.02;

        if (!inOpenSet[neighborIdx]) {
          heap.push(neighborIdx);
          inOpenSet[neighborIdx] = 1;
        }
      }
    }
  }

  return [startCoord, endCoord];
}

// Solve multi-stoppage chain across the physical track
function solveMultiStopTrack(coords) {
  if (!Array.isArray(coords) || coords.length < 2) return coords;
  const fullTrack = [];
  for (let i = 0; i < coords.length - 1; i++) {
    const c1 = coords[i];
    const c2 = coords[i + 1];
    if (c1 && c2 && c1[0] && c2[0]) {
      const leg = solveTrackBetweenCoords(c1, c2);
      if (leg && leg.length > 0) {
        if (fullTrack.length > 0 && leg.length > 0) {
          fullTrack.push(...leg.slice(1));
        } else {
          fullTrack.push(...leg);
        }
      }
    }
  }
  return fullTrack.length > 2 ? fullTrack : coords;
}

module.exports = {
  solveTrackBetweenCoords,
  solveMultiStopTrack,
  findNearestNode
};
