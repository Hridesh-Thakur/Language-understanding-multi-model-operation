import React, { useState, useEffect, useCallback } from 'react';
import {
  Battery,
  BatteryCharging,
  BatteryFull,
  BatteryMedium,
  BatteryLow,
  MapPin,
  Navigation,
  RefreshCcw,
  Zap,
  Compass,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react';

interface DeviceBatteryState {
  level: number | null; // 0 to 1
  charging: boolean | null;
  supported: boolean;
  chargingTime: number | null;
  dischargingTime: number | null;
}

interface DeviceLocationState {
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
  altitude: number | null;
  heading: number | null;
  speed: number | null;
  status: 'idle' | 'locating' | 'active' | 'denied' | 'unsupported';
  errorMessage: string | null;
  timestamp: number | null;
}

export const DeviceTelemetryWidget: React.FC = () => {
  const [battery, setBattery] = useState<DeviceBatteryState>({
    level: null,
    charging: null,
    supported: true,
    chargingTime: null,
    dischargingTime: null,
  });

  const [location, setLocation] = useState<DeviceLocationState>({
    latitude: null,
    longitude: null,
    accuracy: null,
    altitude: null,
    heading: null,
    speed: null,
    status: 'idle',
    errorMessage: null,
    timestamp: null,
  });

  const [expanded, setExpanded] = useState(false);

  // Monitor Battery Status live via Navigator.getBattery API
  useEffect(() => {
    let batteryObj: any = null;

    const updateBatteryInfo = (batt: any) => {
      setBattery({
        level: batt.level,
        charging: batt.charging,
        supported: true,
        chargingTime: batt.chargingTime,
        dischargingTime: batt.dischargingTime,
      });
    };

    if ('getBattery' in navigator) {
      (navigator as any)
        .getBattery()
        .then((batt: any) => {
          batteryObj = batt;
          updateBatteryInfo(batt);

          batt.addEventListener('levelchange', () => updateBatteryInfo(batt));
          batt.addEventListener('chargingchange', () => updateBatteryInfo(batt));
        })
        .catch(() => {
          setBattery((prev) => ({ ...prev, supported: false }));
        });
    } else {
      setBattery((prev) => ({ ...prev, supported: false }));
    }

    return () => {
      if (batteryObj) {
        batteryObj.removeEventListener?.('levelchange', () => updateBatteryInfo(batteryObj));
        batteryObj.removeEventListener?.('chargingchange', () => updateBatteryInfo(batteryObj));
      }
    };
  }, []);

  // Request & Refresh exact GPS location coordinates
  const fetchLocation = useCallback(() => {
    if (!('geolocation' in navigator)) {
      setLocation((prev) => ({
        ...prev,
        status: 'unsupported',
        errorMessage: 'Geolocation is not supported on this browser',
      }));
      return;
    }

    setLocation((prev) => ({ ...prev, status: 'locating', errorMessage: null }));

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocation({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          altitude: pos.coords.altitude,
          heading: pos.coords.heading,
          speed: pos.coords.speed,
          status: 'active',
          errorMessage: null,
          timestamp: pos.timestamp,
        });
      },
      (err) => {
        let msg = 'Failed to retrieve location';
        if (err.code === err.PERMISSION_DENIED) {
          msg = 'Location access denied by user or browser iframe policy';
        } else if (err.code === err.POSITION_UNAVAILABLE) {
          msg = 'Location position unavailable';
        } else if (err.code === err.TIMEOUT) {
          msg = 'Location request timed out';
        }
        setLocation((prev) => ({
          ...prev,
          status: 'denied',
          errorMessage: msg,
        }));
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 10000 }
    );
  }, []);

  // Fetch initial location
  useEffect(() => {
    fetchLocation();
  }, [fetchLocation]);

  // Battery status icon selector
  const renderBatteryIcon = () => {
    if (battery.charging) {
      return <BatteryCharging className="w-4 h-4 text-emerald-400 animate-pulse" />;
    }
    if (battery.level === null) return <Battery className="w-4 h-4 text-slate-400" />;
    const pct = battery.level * 100;
    if (pct > 75) return <BatteryFull className="w-4 h-4 text-emerald-400" />;
    if (pct > 25) return <BatteryMedium className="w-4 h-4 text-amber-400" />;
    return <BatteryLow className="w-4 h-4 text-rose-400 animate-bounce" />;
  };

  const batteryPercentStr =
    battery.level !== null ? `${Math.round(battery.level * 100)}%` : 'Checking...';

  return (
    <div className="fixed top-18 right-4 z-30 pointer-events-auto max-w-sm w-full sm:w-auto">
      <div className="bg-slate-950/85 border border-white/15 rounded-2xl p-2.5 shadow-2xl backdrop-blur-xl text-white transition-all duration-300">
        {/* Compact Pill Bar */}
        <div
          onClick={() => setExpanded((prev) => !prev)}
          className="flex items-center justify-between space-x-3 px-2 py-1 cursor-pointer hover:bg-white/5 rounded-xl transition-all"
        >
          {/* Battery Status Pill */}
          <div className="flex items-center space-x-1.5 text-xs font-semibold">
            {renderBatteryIcon()}
            <span
              className={
                battery.charging
                  ? 'text-emerald-300 font-bold'
                  : battery.level !== null && battery.level < 0.2
                  ? 'text-rose-400 font-bold'
                  : 'text-slate-200'
              }
            >
              {batteryPercentStr}
            </span>
            {battery.charging && <Zap className="w-3 h-3 text-emerald-400 fill-current" />}
          </div>

          <div className="w-px h-3.5 bg-white/15" />

          {/* Location Status Pill */}
          <div className="flex items-center space-x-1.5 text-xs font-semibold">
            <MapPin
              className={`w-4 h-4 ${
                location.status === 'active'
                  ? 'text-pink-400 animate-pulse'
                  : location.status === 'locating'
                  ? 'text-amber-400 animate-spin'
                  : 'text-slate-400'
              }`}
            />
            <span className="text-slate-200">
              {location.status === 'active' && location.latitude !== null
                ? `${location.latitude.toFixed(2)}°, ${location.longitude?.toFixed(2)}°`
                : location.status === 'locating'
                ? 'Locating GPS...'
                : 'GPS Info'}
            </span>
          </div>

          {/* Expand toggle */}
          <span className="text-[10px] uppercase tracking-wider font-bold text-pink-400 bg-pink-500/10 border border-pink-500/20 px-1.5 py-0.5 rounded-md">
            {expanded ? 'Less' : 'Details'}
          </span>
        </div>

        {/* Expanded Detailed Device Telemetry View */}
        {expanded && (
          <div className="mt-3 pt-3 border-t border-white/10 space-y-3 animate-fade-in text-xs font-mono">
            {/* Battery Details */}
            <div className="bg-slate-900/90 border border-white/10 p-2.5 rounded-xl space-y-1">
              <div className="flex items-center justify-between text-slate-300 font-bold">
                <div className="flex items-center space-x-1.5">
                  {renderBatteryIcon()}
                  <span>Exact Battery Status</span>
                </div>
                <span className="text-emerald-400 text-sm font-black">
                  {battery.level !== null ? `${Math.round(battery.level * 100)}%` : 'N/A'}
                </span>
              </div>
              <div className="text-[11px] text-slate-400 flex justify-between pt-1">
                <span>Power Mode:</span>
                <span className="text-slate-200 font-sans">
                  {battery.charging
                    ? '⚡ Charging (Connected)'
                    : '🔋 Discharging (On Battery)'}
                </span>
              </div>
              {!battery.supported && (
                <p className="text-[10px] text-amber-400/90 pt-1">
                  Note: Battery Status API limited on this browser environment.
                </p>
              )}
            </div>

            {/* Geolocation Details */}
            <div className="bg-slate-900/90 border border-white/10 p-2.5 rounded-xl space-y-1.5">
              <div className="flex items-center justify-between text-slate-300 font-bold">
                <div className="flex items-center space-x-1.5">
                  <Navigation className="w-3.5 h-3.5 text-pink-400" />
                  <span>Exact Device GPS Location</span>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    fetchLocation();
                  }}
                  className="p-1 rounded bg-white/10 hover:bg-white/20 text-slate-200 transition-all cursor-pointer"
                  title="Refresh GPS Location"
                >
                  <RefreshCcw className="w-3 h-3" />
                </button>
              </div>

              {location.status === 'active' && location.latitude !== null ? (
                <div className="space-y-1 text-[11px] text-slate-300 pt-1">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Latitude:</span>
                    <span className="font-bold text-pink-300">{location.latitude}°</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Longitude:</span>
                    <span className="font-bold text-pink-300">{location.longitude}°</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">GPS Accuracy:</span>
                    <span className="text-emerald-400">
                      ±{Math.round(location.accuracy || 0)}m
                    </span>
                  </div>
                </div>
              ) : location.status === 'locating' ? (
                <p className="text-[11px] text-amber-300 animate-pulse py-1">
                  Acquiring satellite GPS coordinates...
                </p>
              ) : (
                <div className="text-[11px] text-rose-300 py-1 flex items-start space-x-1">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>{location.errorMessage || 'GPS Location not available'}</span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
