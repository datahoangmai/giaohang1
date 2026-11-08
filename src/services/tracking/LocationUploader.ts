import { DriverLocationLog } from '../../types/delivery';
import { db, isLiveConfigured } from '../api/ApiClient';

/**
 * Đẩy vị trí tài xế lên Supabase (bảng driver_locations).
 * - Hàng đợi lưu trong IndexedDB: mất mạng vẫn giữ, có mạng gửi bù theo thứ tự thời gian.
 * - Gửi lặp không tạo trùng (unique driver_id + recorded_at, dùng ignore-duplicates).
 */
const DB_NAME = 'hachihi_location_queue';
const STORE = 'points';
const MAX_QUEUE = 2000;

interface QueuedPoint {
  id?: number;
  driver_id: string;
  route_id: string | null;
  latitude: number;
  longitude: number;
  accuracy_m: number | null;
  speed_kmh: number | null;
  heading: number | null;
  recorded_at: string;
  source: string;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (d) =>
      new Promise<T>((resolve, reject) => {
        const t = d.transaction(STORE, mode);
        const r = fn(t.objectStore(STORE));
        t.oncomplete = () => {
          resolve(r.result);
          d.close();
        };
        t.onerror = () => {
          reject(t.error);
          d.close();
        };
      })
  );
}

class LocationUploaderClass {
  private flushing = false;
  private lastError: string | null = null;
  private memoryQueue: QueuedPoint[] = []; // dự phòng khi IndexedDB không dùng được
  private listeners = new Set<(pending: number, error: string | null) => void>();

  public subscribe(fn: (pending: number, error: string | null) => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private async count(): Promise<number> {
    try {
      return (await tx('readonly', (s) => s.count())) + this.memoryQueue.length;
    } catch {
      return this.memoryQueue.length;
    }
  }

  private async notify() {
    const n = await this.count();
    this.listeners.forEach((fn) => fn(n, this.lastError));
  }

  public async push(driverId: string, routeId: string | null, loc: DriverLocationLog) {
    if (!isLiveConfigured) return;
    const point: QueuedPoint = {
      driver_id: driverId,
      route_id: routeId,
      latitude: loc.lat,
      longitude: loc.lng,
      accuracy_m: loc.accuracy ?? null,
      speed_kmh: loc.speedKmh ?? null,
      heading: loc.heading ?? null,
      recorded_at: loc.timestamp,
      source: 'pwa',
    };
    try {
      await tx('readwrite', (s) => s.add(point));
      const n = await tx('readonly', (s) => s.count());
      if (n > MAX_QUEUE) {
        // bỏ bớt điểm cũ nhất
        const keys = await tx('readonly', (s) => s.getAllKeys());
        await tx('readwrite', (s) => s.delete(IDBKeyRange.bound(keys[0] as number, keys[n - MAX_QUEUE - 1] as number)));
      }
    } catch {
      this.memoryQueue.push(point);
      if (this.memoryQueue.length > MAX_QUEUE) this.memoryQueue.shift();
    }
    void this.flush();
  }

  public async flush() {
    if (this.flushing || !isLiveConfigured) return;
    this.flushing = true;
    try {
      for (let guard = 0; guard < 20; guard++) {
        let batch: QueuedPoint[] = [];
        try {
          batch = await tx('readonly', (s) => s.getAll(undefined, 50));
        } catch {
          /* IndexedDB lỗi: dùng hàng đợi bộ nhớ */
        }
        const fromMemory = batch.length === 0 && this.memoryQueue.length > 0;
        if (fromMemory) batch = this.memoryQueue.slice(0, 50);
        if (!batch.length) break;

        batch.sort((a, b) => a.recorded_at.localeCompare(b.recorded_at));
        const rows = batch.map(({ id: _id, ...rest }) => rest);
        await db('driver_locations?on_conflict=driver_id,recorded_at', {
          method: 'POST',
          body: rows,
          prefer: 'resolution=ignore-duplicates,return=minimal',
        });
        if (fromMemory) this.memoryQueue.splice(0, batch.length);
        else {
          const ids = batch.map((b) => b.id!);
          await tx('readwrite', (s) => s.delete(IDBKeyRange.bound(Math.min(...ids), Math.max(...ids))));
        }
        this.lastError = null;
      }
    } catch (e) {
      this.lastError = (e as Error).message; // mất mạng / hết phiên: giữ hàng đợi, thử lại lần sau
    } finally {
      this.flushing = false;
      void this.notify();
    }
  }
}

export const LocationUploader = new LocationUploaderClass();

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => void LocationUploader.flush());
}
