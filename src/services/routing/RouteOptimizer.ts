export interface RoutePoint {
  id: string;
  name: string;
  lat: number;
  lng: number;
}

export interface OptimizationResult {
  optimizedPoints: RoutePoint[];
  originalDistanceKm: number;
  optimizedDistanceKm: number;
  savedDistanceKm: number;
  savedPercent: number;
  iterations: number;
}

export class RouteOptimizer {
  /**
   * Great-circle distance between two points on Earth using the Haversine formula (km)
   * With Vietnam urban road factor 1.35x
   */
  static haversineDistance(
    p1: [number, number],
    p2: [number, number],
    applyUrbanMultiplier = true
  ): number {
    const R = 6371; // Earth radius in km
    const dLat = ((p2[0] - p1[0]) * Math.PI) / 180;
    const dLng = ((p2[1] - p1[1]) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((p1[0] * Math.PI) / 180) *
        Math.cos((p2[0] * Math.PI) / 180) *
        Math.sin(dLng / 2) *
        Math.sin(dLng / 2);
    const directKm = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return applyUrbanMultiplier ? directKm * 1.35 : directKm;
  }

  static calculatePathDistance(hub: [number, number], points: RoutePoint[]): number {
    if (points.length === 0) return 0;
    let dist = this.haversineDistance(hub, [points[0].lat, points[0].lng]);
    for (let i = 0; i < points.length - 1; i++) {
      dist += this.haversineDistance(
        [points[i].lat, points[i].lng],
        [points[i + 1].lat, points[i + 1].lng]
      );
    }
    return parseFloat(dist.toFixed(2));
  }

  /**
   * 2-Opt TSP Heuristic
   */
  static optimize(hub: [number, number], points: RoutePoint[]): OptimizationResult {
    const originalDistance = this.calculatePathDistance(hub, points);
    if (points.length <= 2) {
      return {
        optimizedPoints: [...points],
        originalDistanceKm: originalDistance,
        optimizedDistanceKm: originalDistance,
        savedDistanceKm: 0,
        savedPercent: 0,
        iterations: 0,
      };
    }

    // Step 1: Initial pass with Nearest Neighbor
    const unvisited = [...points];
    let currentPos = hub;
    const nnRoute: RoutePoint[] = [];

    while (unvisited.length > 0) {
      let closestIdx = 0;
      let minD = Infinity;

      for (let i = 0; i < unvisited.length; i++) {
        const d = this.haversineDistance(currentPos, [unvisited[i].lat, unvisited[i].lng]);
        if (d < minD) {
          minD = d;
          closestIdx = i;
        }
      }

      const picked = unvisited.splice(closestIdx, 1)[0];
      nnRoute.push(picked);
      currentPos = [picked.lat, picked.lng];
    }

    // Step 2: 2-Opt Iterative Edge Swapping
    let bestRoute = [...nnRoute];
    let bestDist = this.calculatePathDistance(hub, bestRoute);
    let improved = true;
    let iterations = 0;
    const MAX_ITER = 60;

    while (improved && iterations < MAX_ITER) {
      improved = false;
      iterations++;

      for (let i = 0; i < bestRoute.length - 1; i++) {
        for (let k = i + 1; k < bestRoute.length; k++) {
          const newRoute = [
            ...bestRoute.slice(0, i),
            ...bestRoute.slice(i, k + 1).reverse(),
            ...bestRoute.slice(k + 1),
          ];

          const newDist = this.calculatePathDistance(hub, newRoute);
          if (newDist < bestDist - 0.05) {
            bestRoute = newRoute;
            bestDist = newDist;
            improved = true;
            break;
          }
        }
        if (improved) break;
      }
    }

    const savedDistance = Math.max(0, originalDistance - bestDist);
    const savedPercent =
      originalDistance > 0 ? Math.round((savedDistance / originalDistance) * 100) : 0;

    return {
      optimizedPoints: bestRoute,
      originalDistanceKm: originalDistance,
      optimizedDistanceKm: parseFloat(bestDist.toFixed(2)),
      savedDistanceKm: parseFloat(savedDistance.toFixed(2)),
      savedPercent,
      iterations,
    };
  }
}
