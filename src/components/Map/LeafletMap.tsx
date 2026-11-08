import React, { useEffect, useRef, useState, useCallback } from 'react';
import L from 'leaflet';
import {
  Crosshair,
  Locate,
  Layers,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Warehouse,
  ExternalLink,
  Phone,
  CheckCircle2,
  Clock,
  AlertCircle,
  Truck,
  Bike,
  Navigation,
  Flame,
  CheckSquare,
  Square,
} from 'lucide-react';
import { DeliveryRoute, DriverProfile, RouteStop } from '../../types/delivery';
import { CENTRAL_HUB } from '../../config/depot';

export interface UserLocation {
  lat: number;
  lng: number;
  accuracy: number;
  timestamp: number;
}

export interface LeafletMapProps {
  route?: DeliveryRoute;
  activeRoute?: DeliveryRoute;
  stops?: RouteStop[];
  drivers?: DriverProfile[];
  selectedStopId?: string;
  onSelectStop?: (stop: RouteStop) => void;
  onOpenPODModal?: (stop: RouteStop) => void;
  userLocation?: UserLocation | null;
  setUserLocation?: (loc: UserLocation | null) => void;
  isLocating?: boolean;
  setIsLocating?: (val: boolean) => void;
  locateError?: string | null;
  setLocateError?: (err: string | null) => void;
  // Google My Maps layer visibility controls
  showStopsLayer?: boolean;
  showRoutePolyline?: boolean;
  showDriversLayer?: boolean;
  showHubLayer?: boolean;
  targetCoordinates?: { lat: number; lng: number; zoom?: number } | null;
}

type TileLayerKey = 'google_streets' | 'google_hybrid' | 'google_terrain' | 'osm_standard' | 'esri_streets' | 'osm_hot';

const TILE_LAYERS: Record<TileLayerKey, { name: string; url: string; attribution: string; maxZoom: number; subdomains?: string }> = {
  google_streets: {
    name: 'Bản Đồ Đường Phố (Google Roads - Sắc Nét)',
    url: 'https://mt{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}',
    attribution: '&copy; Google Maps &bull; Open Roads',
    maxZoom: 20,
    subdomains: '0123',
  },
  google_hybrid: {
    name: 'Ảnh Vệ Tinh Đô Thị (Google Hybrid Vệ Tinh)',
    url: 'https://mt{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',
    attribution: '&copy; Google Maps Satellite Imagery',
    maxZoom: 20,
    subdomains: '0123',
  },
  google_terrain: {
    name: 'Bản Đồ Địa Hình (Google Terrain)',
    url: 'https://mt{s}.google.com/vt/lyrs=p&x={x}&y={y}&z={z}',
    attribution: '&copy; Google Maps Terrain',
    maxZoom: 20,
    subdomains: '0123',
  },
  osm_standard: {
    name: 'OpenStreetMap Tiêu Chuẩn (OSM France)',
    url: 'https://{s}.tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
    maxZoom: 19,
    subdomains: 'abc',
  },
  esri_streets: {
    name: 'Esri World Street (Đô Thị Toàn Cầu)',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles &copy; Esri World Street Map',
    maxZoom: 19,
  },
  osm_hot: {
    name: 'OpenStreetMap Nhân Đạo (HOT OSM)',
    url: 'https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
    maxZoom: 19,
    subdomains: 'abc',
  },
};

export const LeafletMap: React.FC<LeafletMapProps> = ({
  route,
  activeRoute,
  stops,
  drivers = [],
  selectedStopId,
  onSelectStop,
  onOpenPODModal,
  userLocation,
  setUserLocation = () => {},
  isLocating = false,
  setIsLocating = () => {},
  locateError = null,
  setLocateError = () => {},
  showStopsLayer = true,
  showRoutePolyline = true,
  showDriversLayer = true,
  showHubLayer = true,
  targetCoordinates = null,
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);

  // Markers and layers groups
  const markersGroupRef = useRef<L.LayerGroup | null>(null);
  const userLocationLayerRef = useRef<L.LayerGroup | null>(null);
  const polylineRef = useRef<L.Polyline | null>(null);

  // Default to 100% Free un-watermarked tiles
  const [activeLayer, setActiveLayer] = useState<TileLayerKey>('google_streets');
  const [showLayerMenu, setShowLayerMenu] = useState(false);


  // Normalized stops list sorted strictly according to sequenceOrder
  const currentRoute = activeRoute || route;
  const currentStops: RouteStop[] = stops || currentRoute?.stops || [];
  const sortedStops = [...currentStops].sort((a, b) => a.sequenceOrder - b.sequenceOrder);


  // Initialize Map
  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) return;

    const initialMap = L.map(mapContainerRef.current, {
      center: [CENTRAL_HUB.lat, CENTRAL_HUB.lng],
      zoom: 13,
      zoomControl: false,
      attributionControl: false,
    });

    // Add Attribution manually in minimal format
    L.control.attribution({ position: 'bottomright', prefix: false }).addTo(initialMap);

    // Initial Tile Layer with correct subdomains
    const initialTileConfig = TILE_LAYERS[activeLayer];
    const tileLayer = L.tileLayer(initialTileConfig.url, {
      attribution: initialTileConfig.attribution,
      maxZoom: initialTileConfig.maxZoom,
      subdomains: initialTileConfig.subdomains || 'abc',
    }).addTo(initialMap);

    tileLayerRef.current = tileLayer;
    markersGroupRef.current = L.layerGroup().addTo(initialMap);
    userLocationLayerRef.current = L.layerGroup().addTo(initialMap);
    mapInstanceRef.current = initialMap;

    // Auto-fit initial stops bounds with nice padding
    if (sortedStops.length > 0) {
      const initialPoints: [number, number][] = [
        [CENTRAL_HUB.lat, CENTRAL_HUB.lng],
        ...sortedStops.map((s) => [s.order.lat, s.order.lng] as [number, number]),
      ];
      const bounds = L.latLngBounds(initialPoints);
      initialMap.fitBounds(bounds, { padding: [60, 60], maxZoom: 15 });
    }


    // Critical fix: ResizeObserver to ensure Leaflet never suffers from 0px container or misaligned tiles
    const resizeObserver = new ResizeObserver(() => {
      initialMap.invalidateSize();
    });
    if (mapContainerRef.current) {
      resizeObserver.observe(mapContainerRef.current);
    }

    const onWindowResize = () => {
      initialMap.invalidateSize();
    };
    window.addEventListener('resize', onWindowResize);

    // Delayed invalidation to handle React flex layout settling
    const t1 = setTimeout(() => initialMap.invalidateSize(), 100);
    const t2 = setTimeout(() => initialMap.invalidateSize(), 350);
    const t3 = setTimeout(() => initialMap.invalidateSize(), 800);

    return () => {
      window.removeEventListener('resize', onWindowResize);
      resizeObserver.disconnect();
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      initialMap.remove();
      mapInstanceRef.current = null;
    };
  }, []);

  // Update Tile Layer when layer key changes
  useEffect(() => {
    if (!mapInstanceRef.current) return;
    if (tileLayerRef.current) {
      tileLayerRef.current.remove();
    }
    const config = TILE_LAYERS[activeLayer];
    const newTileLayer = L.tileLayer(config.url, {
      attribution: config.attribution,
      maxZoom: config.maxZoom,
      subdomains: config.subdomains || 'abc',
    }).addTo(mapInstanceRef.current);
    tileLayerRef.current = newTileLayer;
    newTileLayer.bringToBack();
  }, [activeLayer]);

  // Auto-fit bounds whenever route stops change (e.g. dispatched from Odoo)
  useEffect(() => {
    if (!mapInstanceRef.current || sortedStops.length === 0) return;
    const points: [number, number][] = [
      [CENTRAL_HUB.lat, CENTRAL_HUB.lng],
      ...sortedStops.map((s) => [s.order.lat, s.order.lng] as [number, number]),
    ];
    if (points.length > 1) {
      const bounds = L.latLngBounds(points);
      mapInstanceRef.current.fitBounds(bounds, { padding: [60, 60], maxZoom: 15 });
    }
  }, [sortedStops]);

  // Fly to targetCoordinates when requested (e.g. Google My Maps reference location)
  useEffect(() => {
    if (!mapInstanceRef.current || !targetCoordinates) return;
    mapInstanceRef.current.flyTo(
      [targetCoordinates.lat, targetCoordinates.lng],
      targetCoordinates.zoom || 13,
      { animate: true, duration: 1.2 }
    );
  }, [targetCoordinates]);



  // Request & Center on Geolocation
  const handleLocateMe = useCallback(() => {
    setIsLocating(true);
    setLocateError(null);

    if (!navigator.geolocation) {
      setLocateError('Trình duyệt không hỗ trợ Geolocation API.');
      setIsLocating(false);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude, accuracy } = pos.coords;
        const newLoc: UserLocation = {
          lat: latitude,
          lng: longitude,
          accuracy: accuracy || 25,
          timestamp: pos.timestamp,
        };
        setUserLocation(newLoc);
        setIsLocating(false);

        if (mapInstanceRef.current) {
          mapInstanceRef.current.flyTo([latitude, longitude], 16, {
            animate: true,
            duration: 1.2,
          });
        }
      },
      (err) => {
        setIsLocating(false);
        console.warn('Geolocation error:', err);
        let msg = 'Không thể lấy vị trí hiện tại.';
        if (err.code === 1) {
          msg = 'Quyền truy cập vị trí (GPS) đã bị từ chối.';
        } else if (err.code === 2) {
          msg = 'Không tìm thấy tín hiệu vị trí GPS.';
        } else if (err.code === 3) {
          msg = 'Hết thời gian chờ lấy vị trí GPS.';
        }
        setLocateError(msg);
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 15000,
      }
    );
  }, [setIsLocating, setLocateError, setUserLocation]);

  // Center on Central Hub
  const handleCenterHub = () => {
    if (!mapInstanceRef.current) return;
    mapInstanceRef.current.flyTo([CENTRAL_HUB.lat, CENTRAL_HUB.lng], 14, {
      animate: true,
      duration: 1.0,
    });
  };

  // Fit all stops & warehouse
  const handleFitAllStops = () => {
    if (!mapInstanceRef.current) return;
    const points: [number, number][] = [
      [CENTRAL_HUB.lat, CENTRAL_HUB.lng],
      ...sortedStops.map((s) => [s.order.lat, s.order.lng] as [number, number]),
    ];
    if (userLocation) {
      points.push([userLocation.lat, userLocation.lng]);
    }

    if (points.length > 1) {
      const bounds = L.latLngBounds(points);
      mapInstanceRef.current.fitBounds(bounds, { padding: [50, 50], maxZoom: 15 });
    }
  };


  // Update User Location Marker & Accuracy Ring
  useEffect(() => {
    if (!mapInstanceRef.current || !userLocationLayerRef.current) return;
    userLocationLayerRef.current.clearLayers();

    if (!userLocation) return;

    // Accuracy Circle
    const accuracyCircle = L.circle([userLocation.lat, userLocation.lng], {
      radius: userLocation.accuracy,
      color: '#10b981',
      fillColor: '#10b981',
      fillOpacity: 0.15,
      weight: 1,
      dashArray: '4, 4',
    });

    // Custom Pulsing User Marker
    const userMarkerIcon = L.divIcon({
      className: 'user-gps-marker-container',
      html: `
        <div class="relative flex items-center justify-center w-8 h-8">
          <div class="absolute w-8 h-8 rounded-full bg-emerald-500 opacity-75 gps-pulse-beacon"></div>
          <div class="relative w-4 h-4 rounded-full bg-emerald-400 border-2 border-white shadow-lg flex items-center justify-center">
            <div class="w-1.5 h-1.5 rounded-full bg-slate-900"></div>
          </div>
        </div>
      `,
      iconSize: [32, 32],
      iconAnchor: [16, 16],
    });

    const userMarker = L.marker([userLocation.lat, userLocation.lng], {
      icon: userMarkerIcon,
      zIndexOffset: 1000,
    }).bindPopup(`
      <div class="p-2 text-xs text-slate-100 min-w-[200px]">
        <div class="flex items-center gap-1.5 text-emerald-400 font-semibold mb-1">
          <span class="w-2 h-2 rounded-full bg-emerald-400 animate-ping"></span>
          Vị trí thiết bị của bạn (GPS)
        </div>
        <p class="text-slate-300">Tọa độ: ${userLocation.lat.toFixed(5)}, ${userLocation.lng.toFixed(5)}</p>
        <p class="text-slate-400 mt-0.5">Độ chính xác: &plusmn;${Math.round(userLocation.accuracy)}m</p>
        <p class="text-[10px] text-slate-500 mt-1">Cập nhật: ${new Date(userLocation.timestamp).toLocaleTimeString('vi-VN')}</p>
      </div>
    `);

    userLocationLayerRef.current.addLayer(accuracyCircle);
    userLocationLayerRef.current.addLayer(userMarker);
  }, [userLocation]);

  // Render Warehouse, Stops, Drivers, and Route Polyline
  useEffect(() => {
    if (!mapInstanceRef.current || !markersGroupRef.current) return;
    const group = markersGroupRef.current;
    group.clearLayers();

    // 1. Warehouse Marker (Kho Tổng) - Google Maps Gold Hub Pin
    if (showHubLayer) {
      const warehouseIcon = L.divIcon({
        className: 'warehouse-marker',
        html: `
          <div class="relative flex flex-col items-center justify-center cursor-pointer transition-all duration-200 hover:scale-110">
            <svg width="38" height="48" viewBox="0 0 34 44" fill="none" style="filter: drop-shadow(0 4px 8px rgba(0,0,0,0.55));">
              <path d="M17 0C7.611 0 0 7.611 0 17C0 29.75 17 44 17 44C17 44 34 29.75 34 17C34 7.611 26.389 0 17 0Z" fill="#F29900"/>
              <path d="M17 1.5C8.44 1.5 1.5 8.44 1.5 17C1.5 28.5 17 41.8 17 41.8C17 41.8 32.5 28.5 32.5 17C32.5 8.44 25.56 1.5 17 1.5Z" stroke="#FFFFFF" stroke-width="1.5" stroke-opacity="0.8"/>
              <circle cx="17" cy="16" r="10.5" fill="#FFFFFF"/>
            </svg>
            <span class="absolute top-[7px] text-[13px] leading-none">🏢</span>
            <span class="absolute -bottom-1.5 px-1.5 py-0.2 bg-amber-500 text-slate-950 font-black text-[9px] rounded shadow-md border border-amber-300">KHO TỔNG</span>
          </div>
        `,
        iconSize: [38, 48],
        iconAnchor: [19, 44],
        popupAnchor: [0, -42],
      });

      const warehouseMarker = L.marker([CENTRAL_HUB.lat, CENTRAL_HUB.lng], {
        icon: warehouseIcon,
        zIndexOffset: 500,
      }).bindPopup(`
        <div class="p-2.5 text-xs text-slate-100 min-w-[220px]">
          <div class="flex items-center gap-1.5 font-bold text-amber-400 mb-1">
            <span>🏢</span> ${CENTRAL_HUB.name}
          </div>
          <p class="text-slate-300 leading-tight text-[11px] mb-2">${CENTRAL_HUB.address}</p>
          <div class="bg-slate-800/80 rounded px-2 py-1 text-[11px] text-slate-300 flex justify-between">
            <span>Điểm xuất phát:</span>
            <span class="text-amber-400 font-medium">Kho Tổng Odoo 14</span>
          </div>
        </div>
      `);
      group.addLayer(warehouseMarker);
    }

    // 2. Delivery Stops Markers & Polyline (strictly following sequenceOrder)
    const routeCoords: [number, number][] = [[CENTRAL_HUB.lat, CENTRAL_HUB.lng]];

    sortedStops.forEach((stop) => {
      routeCoords.push([stop.order.lat, stop.order.lng]);

      if (!showStopsLayer) return;

      const isSelected = selectedStopId === stop.id;

      // Authentic Google Maps Pin Colors:
      // Red: Selected Active Stop (#EA4335)
      // Green: Completed (#1E8E3E)
      // Orange: Arrived (#F9AB00)
      // Red: Failed (#D93025)
      // Blue: Pending (#1A73E8)
      let pinColor = '#1A73E8'; // Google Blue
      let statusText = 'Chưa giao';
      let statusIcon = '🔵';
      let badgeBg = 'bg-blue-600';

      if (stop.status === 'completed') {
        pinColor = '#1E8E3E'; // Google Green
        statusText = 'Đã giao thành công';
        statusIcon = '🟢';
        badgeBg = 'bg-emerald-600';
      } else if (stop.status === 'arrived') {
        pinColor = '#F9AB00'; // Google Amber
        statusText = 'Đã đến điểm giao';
        statusIcon = '🟠';
        badgeBg = 'bg-amber-500';
      } else if (stop.status === 'failed') {
        pinColor = '#D93025'; // Google Red
        statusText = 'Giao thất bại';
        statusIcon = '🔴';
        badgeBg = 'bg-rose-600';
      }

      if (isSelected) {
        pinColor = '#EA4335'; // Selected stop highlighted with Google Red
      }

      const stopIcon = L.divIcon({
        className: 'delivery-stop-marker',
        html: `
          <div class="relative flex flex-col items-center justify-center cursor-pointer transition-all duration-200 ${
            isSelected ? 'scale-125 z-[900]' : 'hover:scale-115'
          }">
            <svg width="34" height="44" viewBox="0 0 34 44" fill="none" style="filter: drop-shadow(0 4px 6px rgba(0,0,0,0.5));">
              <path d="M17 0C7.611 0 0 7.611 0 17C0 29.75 17 44 17 44C17 44 34 29.75 34 17C34 7.611 26.389 0 17 0Z" fill="${pinColor}"/>
              <path d="M17 1.5C8.44 1.5 1.5 8.44 1.5 17C1.5 28.5 17 41.8 17 41.8C17 41.8 32.5 28.5 32.5 17C32.5 8.44 25.56 1.5 17 1.5Z" stroke="#FFFFFF" stroke-width="1.5" stroke-opacity="0.8"/>
              <circle cx="17" cy="16" r="10" fill="#FFFFFF"/>
            </svg>
            <span class="absolute top-[7.5px] text-[12px] font-black text-slate-900 select-none">${stop.sequenceOrder}</span>
            ${isSelected ? '<span class="absolute -bottom-1 w-4 h-1 bg-black/40 rounded-full blur-[1px]"></span>' : ''}
          </div>
        `,
        iconSize: [34, 44],
        iconAnchor: [17, 42],
        popupAnchor: [0, -40],
      });

      const marker = L.marker([stop.order.lat, stop.order.lng], {
        icon: stopIcon,
        zIndexOffset: isSelected ? 800 : 300,
      });

      // Bind rich popup with action buttons
      const popupHtml = `
        <div class="p-2 text-xs text-slate-100 min-w-[240px]">
          <div class="flex items-center justify-between gap-2 border-b border-slate-700/80 pb-2 mb-2">
            <span class="inline-flex items-center gap-1 font-bold text-sky-400">
              <span class="w-5 h-5 rounded-full ${badgeBg} text-white flex items-center justify-center text-[10px] font-black">#${stop.sequenceOrder}</span>
              ${stop.order.odooName}
            </span>
            <span class="text-[11px] font-medium text-slate-300">${statusIcon} ${statusText}</span>
          </div>

          <p class="font-semibold text-slate-200 text-sm mb-0.5">${stop.order.customerName}</p>
          <p class="text-slate-400 text-[11px] mb-2 leading-relaxed flex items-start gap-1">
            <span>📍</span> <span>${stop.order.deliveryAddress}</span>
          </p>

          <div class="grid grid-cols-2 gap-1.5 bg-slate-800/80 p-2 rounded-lg text-[11px] mb-2.5">
            <div>
              <span class="text-slate-400 block text-[10px]">Tiền thu COD:</span>
              <span class="font-semibold text-emerald-400">
                ${stop.order.codAmount > 0 ? `${stop.order.codAmount.toLocaleString('vi-VN')} đ` : '0 đ (Đã TT)'}
              </span>
            </div>
            <div>
              <span class="text-slate-400 block text-[10px]">Số điện thoại:</span>
              <a href="tel:${stop.order.customerPhone}" class="font-medium text-sky-400 hover:underline">
                ${stop.order.customerPhone}
              </a>
            </div>
          </div>

          <div class="flex items-center gap-2 pt-1">
            <a 
              href="https://www.google.com/maps/dir/?api=1&destination=${stop.order.lat},${stop.order.lng}" 
              target="_blank" 
              rel="noopener noreferrer"
              class="flex-1 inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-medium border border-slate-700 transition-colors"
            >
              <span>🧭 Dẫn đường Google</span>
            </a>
          </div>
        </div>
      `;

      marker.bindPopup(popupHtml);

      marker.on('click', () => {
        if (onSelectStop) onSelectStop(stop);
      });

      group.addLayer(marker);
    });

    // 3. Driver Markers & Real-time GPS Tracking
    if (showDriversLayer) {
      // 3a. Draw Driver GPS Breadcrumb History Trail (Dấu vết di chuyển 10s)
      if (currentRoute?.locationHistory && currentRoute.locationHistory.length > 1) {
        const historyPoints: [number, number][] = currentRoute.locationHistory.map((h) => [h.lat, h.lng]);
        const breadcrumbLine = L.polyline(historyPoints, {
          color: '#06b6d4', // Cyan track line
          weight: 4,
          dashArray: '4, 6',
          opacity: 0.85,
        });
        breadcrumbLine.bindTooltip('Vết di chuyển GPS tài xế (chu kỳ 10s)', { sticky: true });
        group.addLayer(breadcrumbLine);

        // Small pulse dots along history points
        currentRoute.locationHistory.forEach((pt, pIdx) => {
          if (pIdx % 2 === 0) {
            const dot = L.circleMarker([pt.lat, pt.lng], {
              radius: 3,
              color: '#0891b2',
              fillColor: '#22d3ee',
              fillOpacity: 0.8,
              weight: 1,
            });
            group.addLayer(dot);
          }
        });
      }

      // 3b. Render Driver Markers
      drivers.forEach((driver) => {
        const isMotorbike = driver.vehicleType === 'motorbike';
        const isOnline = driver.currentStatus !== 'offline';
        const isActiveTrackedDriver = driver.id === currentRoute?.driverId;
        const liveLoc = isActiveTrackedDriver ? currentRoute?.currentDriverLocation : null;

        const effectiveLat = liveLoc ? liveLoc.lat : driver.currentLat;
        const effectiveLng = liveLoc ? liveLoc.lng : driver.currentLng;
        const speedKmh = liveLoc?.speedKmh ?? (driver.currentStatus === 'delivering' ? 26 : 0);

        // Accuracy Halo Ring for active driver
        if (isActiveTrackedDriver && liveLoc?.accuracy) {
          const haloCircle = L.circle([effectiveLat, effectiveLng], {
            radius: Math.min(liveLoc.accuracy, 45),
            color: '#10b981',
            fillColor: '#10b981',
            fillOpacity: 0.12,
            weight: 1.5,
            dashArray: '3, 4',
          });
          group.addLayer(haloCircle);
        }

        const driverIcon = L.divIcon({
          className: 'driver-marker',
          html: `
            <div class="relative flex flex-col items-center justify-center cursor-pointer">
              ${
                isActiveTrackedDriver
                  ? `
                <div class="absolute w-12 h-12 rounded-full bg-emerald-500/25 animate-ping"></div>
                <div class="absolute w-10 h-10 rounded-full border-2 border-dashed border-emerald-400 animate-spin-slow"></div>
              `
                  : `
                <div class="absolute w-9 h-9 rounded-2xl ${
                  isOnline ? 'bg-sky-500/20' : 'bg-slate-700/20'
                } driver-pulse-icon"></div>
              `
              }
              <div class="relative w-9 h-9 rounded-xl bg-slate-900 border-2 ${
                isActiveTrackedDriver
                  ? 'border-emerald-400 shadow-lg shadow-emerald-500/40'
                  : isOnline
                  ? 'border-sky-400'
                  : 'border-slate-600'
              } shadow-xl flex items-center justify-center text-sky-400 font-bold transition-transform hover:scale-110">
                <span class="text-base">${isMotorbike ? '🏍️' : '🚗'}</span>
              </div>
              ${
                isActiveTrackedDriver
                  ? `
                <div class="mt-0.5 px-1.5 py-0.2 rounded-full bg-slate-950/95 border border-emerald-400 text-[9px] font-black text-emerald-300 shadow-md whitespace-nowrap flex items-center gap-0.5">
                  <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                  <span>${speedKmh} km/h</span>
                </div>
              `
                  : `
                <span class="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full ${
                  driver.currentStatus === 'delivering'
                    ? 'bg-emerald-400 ring-2 ring-slate-900'
                    : driver.currentStatus === 'idle'
                    ? 'bg-amber-400 ring-2 ring-slate-900'
                    : 'bg-slate-500'
                }"></span>
              `
              }
            </div>
          `,
          iconSize: [48, 54],
          iconAnchor: [24, 27],
        });

        const driverMarker = L.marker([effectiveLat, effectiveLng], {
          icon: driverIcon,
          zIndexOffset: isActiveTrackedDriver ? 950 : 700,
        }).bindPopup(`
          <div class="p-2.5 text-xs text-slate-100 min-w-[230px]">
            <div class="flex items-center gap-2 mb-2 pb-2 border-b border-slate-800">
              <img src="${driver.avatarUrl}" class="w-8 h-8 rounded-full object-cover border border-slate-700" alt="${driver.name}" />
              <div>
                <p class="font-bold text-slate-100 flex items-center gap-1">
                  <span>${driver.name}</span>
                  ${isActiveTrackedDriver ? '<span class="px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-400 text-[9px] font-bold">Đang theo dõi 10s</span>' : ''}
                </p>
                <p class="text-[10px] text-slate-400">${driver.employeeCode} &bull; ${driver.assignedVehiclePlate}</p>
              </div>
            </div>
            <div class="text-[11px] space-y-1.5 text-slate-300">
              <div class="flex justify-between">
                <span class="text-slate-400">Trạng thái:</span>
                <span class="font-medium ${driver.currentStatus === 'delivering' ? 'text-emerald-400' : 'text-amber-400'}">
                  ${driver.currentStatus === 'delivering' ? '🟢 Đang chạy tuyến' : driver.currentStatus === 'idle' ? '🟡 Sẵn sàng nhận đơn' : '⚪ Ngoại tuyến'}
                </span>
              </div>
              ${
                liveLoc
                  ? `
                <div class="flex justify-between">
                  <span class="text-slate-400">Vận tốc GPS:</span>
                  <span class="font-bold text-emerald-400">${speedKmh} km/h</span>
                </div>
                <div class="flex justify-between">
                  <span class="text-slate-400">Độ chính xác:</span>
                  <span class="font-semibold text-emerald-300">&plusmn;${liveLoc.accuracy} m</span>
                </div>
                <div class="flex justify-between">
                  <span class="text-slate-400">Cập nhật lúc:</span>
                  <span class="font-mono text-slate-300">${new Date(liveLoc.timestamp).toLocaleTimeString('vi-VN')}</span>
                </div>
              `
                  : ''
              }
              <div class="flex justify-between">
                <span class="text-slate-400">COD đang giữ:</span>
                <span class="font-semibold text-emerald-400">${driver.codBalanceHolding.toLocaleString('vi-VN')} đ</span>
              </div>
              <div class="flex justify-between">
                <span class="text-slate-400">Đơn xong hôm nay:</span>
                <span class="font-bold text-sky-400">${driver.completedStopsToday} đơn</span>
              </div>
            </div>
          </div>
        `);
        group.addLayer(driverMarker);
      });
    }

    // 4. Route Polyline (kết nối Kho Tổng và các điểm dừng theo thứ tự sequenceOrder)
    if (polylineRef.current) {
      polylineRef.current.remove();
    }

    if (showRoutePolyline && routeCoords.length >= 2) {
      // White casing line (Google Maps turn-by-turn directions border)
      const casingPolyline = L.polyline(routeCoords, {
        color: '#FFFFFF',
        weight: 8,
        opacity: 0.95,
        lineCap: 'round',
        lineJoin: 'round',
      });
      group.addLayer(casingPolyline);

      // Core vibrant Google Directions Blue polyline
      const polyline = L.polyline(routeCoords, {
        color: '#1a73e8', // Google Blue #1a73e8
        weight: 5,
        opacity: 0.98,
        lineCap: 'round',
        lineJoin: 'round',
      });

      polyline.bindTooltip(
        `Lộ trình giao hàng Google Maps: ${sortedStops.length} điểm dừng (#1 -> #${sortedStops.length})`,
        { sticky: true }
      );

      group.addLayer(polyline);
      polylineRef.current = polyline;
    }
  }, [currentRoute, currentStops, drivers, selectedStopId, onSelectStop, showHubLayer, showStopsLayer, showDriversLayer, showRoutePolyline]);

  // Center on selected stop when changed
  useEffect(() => {
    if (!selectedStopId || !mapInstanceRef.current) return;
    const target = sortedStops.find((s) => s.id === selectedStopId);
    if (target) {
      mapInstanceRef.current.flyTo([target.order.lat, target.order.lng], 16, {
        animate: true,
        duration: 0.8,
      });
    }
  }, [selectedStopId, sortedStops]);


  return (
    <div className="relative w-full h-full min-h-full overflow-hidden flex-1">
      {/* Fullscreen Map Container */}
      <div ref={mapContainerRef} className="absolute inset-0 w-full h-full z-0 cursor-grab active:cursor-grabbing" />


      {/* Floating Centering & Map Controls Toolbar */}
      <div className="absolute top-20 right-4 z-[400] flex flex-col gap-2.5">
        {/* User Geolocation Button */}
        <div className="relative group">
          <button
            onClick={handleLocateMe}
            disabled={isLocating}
            title="Định vị vị trí hiện tại của tôi (GPS)"
            aria-label="Center on my geolocation"
            className={`flex items-center justify-center w-11 h-11 rounded-xl shadow-xl transition-all duration-200 backdrop-blur-md border ${
              isLocating
                ? 'bg-emerald-600/90 text-white border-emerald-400 animate-pulse'
                : userLocation
                ? 'bg-slate-900/90 text-emerald-400 hover:text-emerald-300 border-emerald-500/50 hover:border-emerald-400'
                : 'bg-slate-900/90 text-slate-200 hover:text-white border-slate-700/80 hover:border-slate-500'
            }`}
          >
            {isLocating ? (
              <Crosshair className="w-5 h-5 animate-spin" />
            ) : (
              <Locate className={`w-5 h-5 ${userLocation ? 'text-emerald-400' : ''}`} />
            )}
          </button>
          <span className="pointer-events-none absolute right-14 top-1/2 -translate-y-1/2 whitespace-nowrap bg-slate-900/95 text-xs text-slate-200 px-2.5 py-1 rounded-lg border border-slate-700 shadow-xl opacity-0 group-hover:opacity-100 transition-opacity">
            {isLocating ? 'Đang định vị GPS...' : 'Định vị vị trí của tôi'}
          </span>
        </div>

        {/* Central Hub Button */}
        <div className="relative group">
          <button
            onClick={handleCenterHub}
            title="Về Kho Tổng Hachihi (Central Hub)"
            className="flex items-center justify-center w-11 h-11 rounded-xl shadow-xl bg-slate-900/90 text-amber-400 hover:text-amber-300 border border-slate-700/80 hover:border-amber-500/50 transition-all backdrop-blur-md"
          >
            <Warehouse className="w-5 h-5" />
          </button>
          <span className="pointer-events-none absolute right-14 top-1/2 -translate-y-1/2 whitespace-nowrap bg-slate-900/95 text-xs text-slate-200 px-2.5 py-1 rounded-lg border border-slate-700 shadow-xl opacity-0 group-hover:opacity-100 transition-opacity">
            Về Kho Tổng Hachihi
          </span>
        </div>

        {/* Fit All Stops Button */}
        <div className="relative group">
          <button
            onClick={handleFitAllStops}
            title="Xem toàn bộ lộ trình & điểm giao"
            className="flex items-center justify-center w-11 h-11 rounded-xl shadow-xl bg-slate-900/90 text-sky-400 hover:text-sky-300 border border-slate-700/80 hover:border-sky-500/50 transition-all backdrop-blur-md"
          >
            <Maximize2 className="w-5 h-5" />
          </button>
          <span className="pointer-events-none absolute right-14 top-1/2 -translate-y-1/2 whitespace-nowrap bg-slate-900/95 text-xs text-slate-200 px-2.5 py-1 rounded-lg border border-slate-700 shadow-xl opacity-0 group-hover:opacity-100 transition-opacity">
            Bao quát toàn tuyến
          </span>
        </div>

        {/* Zoom Controls */}
        <div className="flex flex-col rounded-xl overflow-hidden shadow-xl border border-slate-700/80 bg-slate-900/90 backdrop-blur-md">
          <button
            onClick={() => mapInstanceRef.current?.zoomIn()}
            title="Phóng to"
            className="flex items-center justify-center w-11 h-10 text-slate-200 hover:text-white hover:bg-slate-800/80 transition-colors border-b border-slate-800"
          >
            <ZoomIn className="w-4 h-4" />
          </button>
          <button
            onClick={() => mapInstanceRef.current?.zoomOut()}
            title="Thu nhỏ"
            className="flex items-center justify-center w-11 h-10 text-slate-200 hover:text-white hover:bg-slate-800/80 transition-colors"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
        </div>

        {/* Layer Selector */}
        <div className="relative">
          <button
            onClick={() => setShowLayerMenu(!showLayerMenu)}
            title="Đổi kiểu bản đồ"
            className="flex items-center justify-center w-11 h-11 rounded-xl shadow-xl bg-slate-900/90 text-slate-200 hover:text-white border border-slate-700/80 hover:border-slate-500 transition-all backdrop-blur-md"
          >
            <Layers className="w-5 h-5" />
          </button>

          {showLayerMenu && (
            <div className="absolute right-14 top-0 w-64 bg-slate-900/95 border border-slate-700 rounded-xl shadow-2xl p-2 z-[500] backdrop-blur-md">
              <p className="text-[11px] font-semibold text-slate-400 px-2 py-1 uppercase tracking-wider">
                Lớp bản đồ OSM
              </p>
              {(Object.keys(TILE_LAYERS) as TileLayerKey[]).map((key) => (
                <button
                  key={key}
                  onClick={() => {
                    setActiveLayer(key);
                    setShowLayerMenu(false);
                  }}
                  className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs font-medium flex items-center justify-between transition-colors ${
                    activeLayer === key
                      ? 'bg-sky-500/20 text-sky-400 border border-sky-500/40'
                      : 'text-slate-300 hover:bg-slate-800/80'
                  }`}
                >
                  <span>{TILE_LAYERS[key].name}</span>
                  {activeLayer === key && <span className="text-sky-400">✓</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Geolocation Warning Toast if Error */}
      {locateError && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-[400] max-w-md w-[92%] bg-rose-950/90 border border-rose-500/60 text-rose-200 px-4 py-2.5 rounded-xl shadow-2xl backdrop-blur-md flex items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            <span>{locateError}</span>
          </div>
          <button
            onClick={() => setLocateError(null)}
            className="text-rose-400 hover:text-white font-bold p-1"
          >
            ✕
          </button>
        </div>
      )}

      {/* Google Maps Floating Satellite / Streets Toggle in Bottom-Left */}
      <div className="absolute bottom-6 left-4 z-[400] flex items-center gap-3">
        <button
          onClick={() => setActiveLayer(activeLayer === 'google_hybrid' ? 'google_streets' : 'google_hybrid')}
          title="Chuyển đổi kiểu xem Vệ tinh / Đường phố (Google Maps)"
          className="group relative w-14 h-14 rounded-2xl overflow-hidden border-2 border-white/80 shadow-2xl transition-all duration-200 hover:scale-105 hover:border-blue-400 cursor-pointer focus:outline-none"
        >
          <div
            className={`absolute inset-0 bg-cover bg-center transition-opacity duration-300 ${
              activeLayer === 'google_hybrid'
                ? 'bg-slate-800'
                : 'bg-emerald-950'
            }`}
            style={{
              backgroundImage: activeLayer === 'google_hybrid'
                ? 'url(https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/13/3956/6763)'
                : 'url(https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/13/3956/6763)',
            }}
          />
          <div className="absolute inset-0 bg-black/35 group-hover:bg-black/15 transition-colors" />
          <div className="absolute bottom-1 inset-x-0 text-center">
            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold text-white bg-black/60 backdrop-blur-xs leading-none shadow">
              {activeLayer === 'google_hybrid' ? 'Bản đồ' : 'Vệ tinh'}
            </span>
          </div>
        </button>

        {/* User Location Info Badge */}
        {userLocation && (
          <div className="hidden sm:flex items-center gap-2 bg-slate-900/90 backdrop-blur-md border border-emerald-500/40 text-slate-200 text-xs px-3 py-2 rounded-xl shadow-xl">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            <span>
              GPS: <strong className="text-emerald-400 font-mono">{userLocation.lat.toFixed(4)}, {userLocation.lng.toFixed(4)}</strong>
              <span className="text-slate-400 text-[10px] ml-1.5 font-normal">(&plusmn;{Math.round(userLocation.accuracy)}m)</span>
            </span>
          </div>
        )}
      </div>
    </div>
  );
};
