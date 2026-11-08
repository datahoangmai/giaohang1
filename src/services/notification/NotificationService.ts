import { DeliveryOrder } from '../../types/delivery';

export interface AppPushNotification {
  id: string;
  title: string;
  body: string;
  timestamp: string;
  orderId?: string;
  orderNumber?: string;
  customerName?: string;
  codAmount?: number;
  read: boolean;
}

export interface ExtendedNotificationOptions extends NotificationOptions {
  renotify?: boolean;
  vibrate?: number[];
  actions?: Array<{ action: string; title: string; icon?: string }>;
}

export type NotificationListener = (notification: AppPushNotification) => void;

class NotificationServiceClass {
  private static instance: NotificationServiceClass | null = null;
  private swRegistration: ServiceWorkerRegistration | null = null;
  private listeners: Set<NotificationListener> = new Set();
  private recentNotifications: AppPushNotification[] = [];
  private audioCtx: AudioContext | null = null;

  private constructor() {
    this.loadStoredNotifications();
    this.initServiceWorker();
  }

  public static getInstance(): NotificationServiceClass {
    if (!NotificationServiceClass.instance) {
      NotificationServiceClass.instance = new NotificationServiceClass();
    }
    return NotificationServiceClass.instance;
  }

  private loadStoredNotifications() {
    try {
      const stored = localStorage.getItem('hachihi_push_notifications');
      if (stored) {
        this.recentNotifications = JSON.parse(stored);
      }
    } catch (e) {
      this.recentNotifications = [];
    }
  }

  private saveStoredNotifications() {
    try {
      localStorage.setItem(
        'hachihi_push_notifications',
        JSON.stringify(this.recentNotifications.slice(0, 30))
      );
    } catch (e) {
      console.warn('Failed to save notifications to localStorage:', e);
    }
  }

  /**
   * Register the Service Worker in public/sw.js
   */
  public async initServiceWorker(): Promise<ServiceWorkerRegistration | null> {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
      console.warn('[NotificationService] Service Worker is not supported in this browser.');
      return null;
    }

    try {
      const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      this.swRegistration = reg;
      console.log('[NotificationService] Service Worker registered successfully:', reg.scope);

      // Listen for message events from service worker (e.g. click on notification)
      navigator.serviceWorker.addEventListener('message', (event) => {
        if (event.data?.type === 'NOTIFICATION_CLICKED') {
          console.log('[NotificationService] Driver clicked notification:', event.data);
        }
      });

      return reg;
    } catch (err) {
      console.warn('[NotificationService] Service Worker registration failed:', err);
      return null;
    }
  }

  public isSupported(): boolean {
    return typeof window !== 'undefined' && 'Notification' in window && 'serviceWorker' in navigator;
  }

  public getPermissionStatus(): NotificationPermission | 'unsupported' {
    if (!this.isSupported()) return 'unsupported';
    return Notification.permission;
  }

  public async requestPermission(): Promise<boolean> {
    if (!this.isSupported()) return false;
    try {
      const permission = await Notification.requestPermission();
      return permission === 'granted';
    } catch (err) {
      console.error('[NotificationService] Error requesting notification permission:', err);
      return false;
    }
  }

  /**
   * Synthesize a crisp dual chime sound using Web Audio API
   */
  public playOrderChime() {
    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;

      if (!this.audioCtx || this.audioCtx.state === 'closed') {
        this.audioCtx = new AudioCtx();
      }

      if (this.audioCtx.state === 'suspended') {
        this.audioCtx.resume();
      }

      const ctx = this.audioCtx;
      const now = ctx.currentTime;

      // Note 1: 587.33 Hz (D5)
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(587.33, now);
      gain1.gain.setValueAtTime(0.25, now);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc1.start(now);
      osc1.stop(now + 0.35);

      // Note 2: 880.00 Hz (A5)
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = 'triangle';
      osc2.frequency.setValueAtTime(880.0, now + 0.12);
      gain2.gain.setValueAtTime(0.3, now + 0.12);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.start(now + 0.12);
      osc2.stop(now + 0.6);
    } catch (e) {
      // Audio playback might be restricted before user gesture
    }
  }

  /**
   * Vibrate device if vibration API is available
   */
  public triggerVibration(pattern: number[] = [250, 100, 250, 100, 400]) {
    try {
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        navigator.vibrate(pattern);
      }
    } catch (e) {
      // Ignore vibration error
    }
  }

  /**
   * Core method to trigger a Push Notification via Service Worker registration
   */
  public async showPushNotification(title: string, options: ExtendedNotificationOptions): Promise<boolean> {
    // 1. Play audible chime & trigger vibration
    this.playOrderChime();
    this.triggerVibration();

    // 2. Add to in-memory history & broadcast to app UI
    const newNotif: AppPushNotification = {
      id: `notif-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      title,
      body: options.body || '',
      timestamp: new Date().toISOString(),
      orderId: (options.data as { orderId?: string })?.orderId,
      orderNumber: (options.data as { orderNumber?: string })?.orderNumber,
      customerName: (options.data as { customerName?: string })?.customerName,
      codAmount: (options.data as { codAmount?: number })?.codAmount,
      read: false,
    };

    this.recentNotifications.unshift(newNotif);
    this.saveStoredNotifications();
    this.broadcast(newNotif);

    // 3. Try showing via Service Worker registration (Standard PWA Push API)
    if (this.isSupported() && Notification.permission === 'granted') {
      try {
        let reg = this.swRegistration;
        if (!reg && navigator.serviceWorker.ready) {
          reg = await navigator.serviceWorker.ready;
        }

        if (reg && reg.showNotification) {
          await reg.showNotification(title, {
            ...options,
            icon: options.icon || '/icon.svg',
            badge: options.badge || '/icon.svg',
          });
          return true;
        }

        // Send message to active SW controller if showNotification directly on reg isn't ready
        if (navigator.serviceWorker.controller) {
          navigator.serviceWorker.controller.postMessage({
            type: 'SHOW_NOTIFICATION',
            title,
            options,
          });
          return true;
        }

        // Direct Window Notification fallback
        new Notification(title, options);
        return true;
      } catch (err) {
        console.warn('[NotificationService] Push notification trigger warning:', err);
      }
    }

    return false;
  }

  /**
   * Specialized high-level method: Notify driver of newly dispatched orders
   */
  public async notifyNewOrdersDispatched(
    orders: DeliveryOrder[],
    driverName?: string
  ): Promise<boolean> {
    if (!orders || orders.length === 0) return false;

    const count = orders.length;
    const firstOrder = orders[0];
    const totalCod = orders.reduce((sum, o) => sum + (o.codAmount || 0), 0);

    const title =
      count === 1
        ? `📦 Đơn Hàng Mới: ${firstOrder.odooName || firstOrder.id}`
        : `📦 Đã Điều Phối ${count} Đơn Hàng Mới Về Máy!`;

    const body =
      count === 1
        ? `Khách: ${firstOrder.customerName} - ${firstOrder.deliveryAddress}. Thu COD: ${firstOrder.codAmount > 0 ? `${firstOrder.codAmount.toLocaleString('vi-VN')} đ` : '0 đ (Đã TT)'}.`
        : `Tài xế ${driverName || 'bạn'} vừa nhận thêm ${count} điểm giao mới. Tổng COD: ${totalCod.toLocaleString('vi-VN')} đ. Kiểm tra ngay!`;

    return this.showPushNotification(title, {
      body,
      icon: '/icon.svg',
      badge: '/icon.svg',
      tag: `new-order-dispatch-${Date.now()}`,
      renotify: true,
      data: {
        url: '/',
        orderId: firstOrder.id,
        orderNumber: firstOrder.odooName,
        customerName: firstOrder.customerName,
        codAmount: totalCod,
        count,
      },
    });
  }

  public getRecentNotifications(): AppPushNotification[] {
    return [...this.recentNotifications];
  }

  public markAsRead(id: string) {
    this.recentNotifications = this.recentNotifications.map((n) =>
      n.id === id ? { ...n, read: true } : n
    );
    this.saveStoredNotifications();
  }

  public clearAll() {
    this.recentNotifications = [];
    this.saveStoredNotifications();
  }

  public subscribe(fn: NotificationListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private broadcast(notif: AppPushNotification) {
    this.listeners.forEach((fn) => {
      try {
        fn(notif);
      } catch (e) {
        console.error('Error in notification listener:', e);
      }
    });
  }
}

export const NotificationService = NotificationServiceClass.getInstance();
