import { DriverLocationLog, DriverProfile, DeliveryRoute, RouteStop } from '../../types/delivery';
import { RouteOptimizer } from '../routing/RouteOptimizer';

export type TrackingMode = 'real_gps';

export type LocationListener = (location: DriverLocationLog) => void;
export type CountdownListener = (secondsRemaining: number) => void;
export type ErrorListener = (error: string) => void;
export type GeofenceListener = (stop: RouteStop, distanceMeters: number) => void;
export type WakeLockListener = (isActive: boolean) => void;

export class DriverTrackingService {
  private static instance: DriverTrackingService | null = null;

  private intervalTimerId: number | null = null;
  private countdownTimerId: number | null = null;
  private secondsRemaining: number = 10;
  private trackingIntervalMs: number = 10000; // 10 seconds per request

  private isRunning: boolean = false;
  private trackingMode: TrackingMode = 'real_gps';
  private lastKnownLocation: DriverLocationLog | null = null;
  private activeDriver: DriverProfile | null = null;
  private activeRoute: DeliveryRoute | null = null;

  // Mobile Screen Wake Lock state (giữ màn hình luôn sáng trên xe máy)
  private wakeLockSentinel: any = null;
  private isWakeLockEnabled: boolean = false;
  private wakeLockListeners: Set<WakeLockListener> = new Set();

  // Listeners
  private locationListeners: Set<LocationListener> = new Set();
  private countdownListeners: Set<CountdownListener> = new Set();
  private errorListeners: Set<ErrorListener> = new Set();
  private geofenceListeners: Set<GeofenceListener> = new Set();

  private constructor() {
    // Page Visibility API: Tự động đồng bộ lại ngay lập tức khi tài xế mở lại app / mở khóa màn hình
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          // Bắt buộc làm mới GPS ngay lập tức
          if (this.isRunning) {
            this.forceUpdateNow();
          }
          // Tái kích hoạt wake lock nếu trước đó đã bật (trình duyệt tự nhả khi tắt màn hình)
          if (this.isWakeLockEnabled) {
            this.requestWakeLock();
          }
        }
      });
    }
  }

  public static getInstance(): DriverTrackingService {
    if (!DriverTrackingService.instance) {
      DriverTrackingService.instance = new DriverTrackingService();
    }
    return DriverTrackingService.instance;
  }

  public subscribeLocation(fn: LocationListener): () => void {
    this.locationListeners.add(fn);
    if (this.lastKnownLocation) {
      fn(this.lastKnownLocation);
    }
    return () => this.locationListeners.delete(fn);
  }

  public subscribeCountdown(fn: CountdownListener): () => void {
    this.countdownListeners.add(fn);
    fn(this.secondsRemaining);
    return () => this.countdownListeners.delete(fn);
  }

  public subscribeError(fn: ErrorListener): () => void {
    this.errorListeners.add(fn);
    return () => this.errorListeners.delete(fn);
  }

  public subscribeGeofence(fn: GeofenceListener): () => void {
    this.geofenceListeners.add(fn);
    return () => this.geofenceListeners.delete(fn);
  }

  public getTrackingMode(): TrackingMode {
    return this.trackingMode;
  }

  public setTrackingMode(_mode: TrackingMode) {
    this.trackingMode = 'real_gps';
  }

  public isTracking(): boolean {
    return this.isRunning;
  }

  public getLastKnownLocation(): DriverLocationLog | null {
    return this.lastKnownLocation;
  }

  public getSecondsRemaining(): number {
    return this.secondsRemaining;
  }

  /**
   * Screen Wake Lock API (Giữ màn hình điện thoại luôn sáng trên giá đỡ xe máy)
   */
  public isWakeLockSupported(): boolean {
    return typeof navigator !== 'undefined' && 'wakeLock' in navigator;
  }

  public isWakeLockActive(): boolean {
    return this.isWakeLockEnabled;
  }

  public async requestWakeLock(): Promise<boolean> {
    if (!this.isWakeLockSupported()) {
      return false;
    }
    try {
      // @ts-ignore
      this.wakeLockSentinel = await navigator.wakeLock.request('screen');
      this.isWakeLockEnabled = true;
      this.wakeLockSentinel.addEventListener('release', () => {
        this.wakeLockSentinel = null;
        if (!this.isWakeLockEnabled) {
          this.broadcastWakeLock(false);
        }
      });
      this.broadcastWakeLock(true);
      return true;
    } catch (err) {
      console.warn('[DriverTrackingService] Screen Wake Lock request warning:', err);
      this.isWakeLockEnabled = false;
      this.broadcastWakeLock(false);
      return false;
    }
  }

  public async releaseWakeLock() {
    this.isWakeLockEnabled = false;
    if (this.wakeLockSentinel) {
      try {
        await this.wakeLockSentinel.release();
      } catch (e) {
        // Ignore
      }
      this.wakeLockSentinel = null;
    }
    this.broadcastWakeLock(false);
  }

  public subscribeWakeLock(fn: WakeLockListener): () => void {
    this.wakeLockListeners.add(fn);
    fn(this.isWakeLockEnabled);
    return () => this.wakeLockListeners.delete(fn);
  }

  private broadcastWakeLock(active: boolean) {
    this.wakeLockListeners.forEach((fn) => {
      try {
        fn(active);
      } catch (e) {
        console.error('Error in wakeLock listener:', e);
      }
    });
  }

  /**
   * Start 10-second real-time tracking cycle
   */
  public start(driver: DriverProfile, route: DeliveryRoute) {
    this.activeDriver = driver;
    this.activeRoute = route;

    if (this.isRunning) {
      return;
    }

    this.isRunning = true;
    this.secondsRemaining = 10;
    this.broadcastCountdown(this.secondsRemaining);

    // Initial position fetch immediately
    this.executeFetchPosition();

    // 1-second countdown ticker for UI responsiveness
    this.countdownTimerId = window.setInterval(() => {
      this.secondsRemaining--;
      if (this.secondsRemaining <= 0) {
        this.secondsRemaining = 10;
        this.executeFetchPosition();
      }
      this.broadcastCountdown(this.secondsRemaining);
    }, 1000);
  }

  /**
   * Stop tracking cycle
   */
  public stop() {
    this.isRunning = false;
    if (this.countdownTimerId !== null) {
      clearInterval(this.countdownTimerId);
      this.countdownTimerId = null;
    }
    if (this.intervalTimerId !== null) {
      clearInterval(this.intervalTimerId);
      this.intervalTimerId = null;
    }
    this.secondsRemaining = 10;
    this.broadcastCountdown(10);
  }

  /**
   * Manually trigger an immediate update right now
   */
  public forceUpdateNow() {
    this.secondsRemaining = 10;
    this.broadcastCountdown(10);
    this.executeFetchPosition();
  }

  /**
   * Update active route reference (e.g. when stops are reordered, completed, or added)
   */
  public updateRoute(route: DeliveryRoute) {
    this.activeRoute = route;
  }

  public updateDriver(driver: DriverProfile) {
    this.activeDriver = driver;
  }

  /**
   * Lấy vị trí GPS thật của thiết bị. Không bao giờ giả lập vị trí.
   */
  private executeFetchPosition() {
    if (!this.isRunning) return;

    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      this.broadcastError('CẢNH BÁO: thiết bị không hỗ trợ định vị GPS, điều phối sẽ không thấy vị trí của bạn.');
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const hasSpeed = position.coords.speed != null && position.coords.speed >= 0;
        const locLog: DriverLocationLog = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: Math.round(position.coords.accuracy || 0),
          speedKmh: hasSpeed ? parseFloat((position.coords.speed! * 3.6).toFixed(1)) : null,
          heading: position.coords.heading ?? null,
          timestamp: new Date().toISOString(),
          source: 'gps',
        };
        this.handleNewLocation(locLog);
      },
      (error) => {
        let errMsg = 'Không thể truy cập Geolocation.';
        switch (error.code) {
          case error.PERMISSION_DENIED:
            errMsg = 'CẢNH BÁO: bạn đã từ chối quyền định vị GPS. Điều phối sẽ không thấy vị trí của bạn — hãy bật lại quyền vị trí cho trang này.';
            break;
          case error.POSITION_UNAVAILABLE:
            errMsg = 'CẢNH BÁO: không lấy được vị trí GPS. Hãy ra nơi thoáng hoặc bật định vị thiết bị.';
            break;
          case error.TIMEOUT:
            errMsg = 'Hết thời gian chờ GPS (timeout). Thử lại chu kỳ sau...';
            break;
        }
        this.broadcastError(errMsg);
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 4000 }
    );
  }

  /**
   * Process new location, notify subscribers, check geofence
   */
  private handleNewLocation(locLog: DriverLocationLog) {
    this.lastKnownLocation = locLog;

    // Check geofence with upcoming stops (< 150m)
    if (this.activeRoute) {
      for (const stop of this.activeRoute.stops) {
        if (stop.status === 'pending') {
          const distKm = RouteOptimizer.haversineDistance(
            [locLog.lat, locLog.lng],
            [stop.order.lat, stop.order.lng],
            false
          );
          const distMeters = Math.round(distKm * 1000);
          if (distMeters <= 150) {
            this.broadcastGeofence(stop, distMeters);
            break;
          }
        }
      }
    }

    // Broadcast to location listeners
    this.broadcastLocation(locLog);
  }

  private broadcastLocation(loc: DriverLocationLog) {
    this.locationListeners.forEach((fn) => {
      try {
        fn(loc);
      } catch (err) {
        console.error('Error in location listener:', err);
      }
    });
  }

  private broadcastCountdown(sec: number) {
    this.countdownListeners.forEach((fn) => {
      try {
        fn(sec);
      } catch (err) {
        console.error('Error in countdown listener:', err);
      }
    });
  }

  private broadcastError(err: string) {
    this.errorListeners.forEach((fn) => {
      try {
        fn(err);
      } catch (e) {
        console.error('Error in error listener:', e);
      }
    });
  }

  private broadcastGeofence(stop: RouteStop, distanceMeters: number) {
    this.geofenceListeners.forEach((fn) => {
      try {
        fn(stop, distanceMeters);
      } catch (e) {
        console.error('Error in geofence listener:', e);
      }
    });
  }
}
