"use client";

import { GoogleMap, MarkerF, PolylineF, useJsApiLoader } from "@react-google-maps/api";
import { useEffect, useMemo, useRef, useState } from "react";

type EventKind = "drive" | "stop";
type EventFilter = "all" | EventKind;
const ALL_VEHICLES_ID = "__all__";

type MapPoint = { lat: number; lng: number };

export type VehicleEvent = {
  id: string;
  vehicleId: string;
  vehicleName: string;
  index: number;
  kind: EventKind;
  status: string;
  startAt: string;
  endAt: string;
  startTimestamp: number | null;
  endTimestamp: number | null;
  duration: string;
  distance: string;
  speedMax: string;
  speedAvg: string;
  locationRaw: string;
  lat: number | null;
  lon: number | null;
  googleMapsUrl: string | null;
};

export type VehicleHistory = {
  id: string;
  fileName: string;
  name: string;
  periodStart: string | null;
  periodEnd: string | null;
  totalDistance: string | null;
  maxSpeed: string | null;
  avgSpeed: string | null;
  error: string | null;
  events: VehicleEvent[];
};

type HistoryDashboardProps = {
  vehicles: VehicleHistory[];
  googleMapsApiKey: string;
};

type AddressLookup = {
  query: string;
  token: number;
};

type AddressSearchStatus = {
  status: "idle" | "searching" | "found" | "not_found" | "error";
  message?: string;
};

type RoutesApiResponse = {
  encodedPolyline?: string;
  points?: MapPoint[];
  warning?: {
    code?: string;
    message?: string;
  };
};

function stripHtml(value: string): string {
  return value.replace(/<[^>]*>/g, "").trim();
}

function toDateAndTimeParts(raw: string | null): { date: string; time: string } {
  if (!raw) return { date: "", time: "" };
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return { date: "", time: "" };
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const day = String(parsed.getDate()).padStart(2, "0");
  const hours = String(parsed.getHours()).padStart(2, "0");
  const minutes = String(parsed.getMinutes()).padStart(2, "0");
  return {
    date: `${year}-${month}-${day}`,
    time: `${hours}:${minutes}`,
  };
}

function parseFilterDateTime(date: string, time: string, fallbackTime: "start" | "end"): number | null {
  if (!date) return null;
  const safeTime = time || (fallbackTime === "start" ? "00:00" : "23:59");
  const timestamp = new Date(`${date}T${safeTime}:00`).getTime();
  return Number.isNaN(timestamp) ? null : timestamp;
}

function parseDistanceKilometers(value: string | null): number | null {
  if (!value) return null;
  const match = value.match(/[-0-9.]+/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isNaN(parsed) ? null : parsed;
}

function distanceSquared(a: MapPoint, b: MapPoint): number {
  const dLat = a.lat - b.lat;
  const dLng = a.lng - b.lng;
  return dLat * dLat + dLng * dLng;
}

function compactRoutePoints(points: MapPoint[]): MapPoint[] {
  if (points.length <= 2) return points;

  const minDistance = 0.00018;
  const minDistanceSq = minDistance * minDistance;
  const compacted: MapPoint[] = [points[0]];

  for (let index = 1; index < points.length; index += 1) {
    const current = points[index];
    const lastKept = compacted[compacted.length - 1];
    if (distanceSquared(current, lastKept) >= minDistanceSq) {
      compacted.push(current);
    }
  }

  const last = points[points.length - 1];
  if (distanceSquared(compacted[compacted.length - 1], last) > 0) {
    compacted.push(last);
  }

  const maxPoints = 90;
  if (compacted.length <= maxPoints) {
    return compacted;
  }

  const step = Math.ceil(compacted.length / maxPoints);
  const sampled = compacted.filter((_, index) => index % step === 0);
  if (distanceSquared(sampled[sampled.length - 1], compacted[compacted.length - 1]) > 0) {
    sampled.push(compacted[compacted.length - 1]);
  }
  return sampled;
}

function decodePolyline(encoded: string): MapPoint[] {
  const points: MapPoint[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let shift = 0;
    let result = 0;
    let byte = 0;

    do {
      byte = encoded.charCodeAt(index) - 63;
      index += 1;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);

    const deltaLat = result & 1 ? ~(result >> 1) : result >> 1;
    lat += deltaLat;

    shift = 0;
    result = 0;
    do {
      byte = encoded.charCodeAt(index) - 63;
      index += 1;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);

    const deltaLng = result & 1 ? ~(result >> 1) : result >> 1;
    lng += deltaLng;

    points.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }

  return points;
}

function buildPointsForRoute(events: VehicleEvent[]): MapPoint[] {
  const drivePoints = events
    .filter((event) => event.kind === "drive" && event.lat !== null && event.lon !== null)
    .map((event) => ({ lat: event.lat as number, lng: event.lon as number }));

  const pointsToUse =
    drivePoints.length >= 2
      ? drivePoints
      : events
          .filter((event) => event.lat !== null && event.lon !== null)
          .map((event) => ({ lat: event.lat as number, lng: event.lon as number }));

  return compactRoutePoints(pointsToUse);
}

function VehicleMap({
  apiKey,
  center,
  pathPoints,
  addressLookup,
  onAddressSearchStatusChange,
}: {
  apiKey: string;
  center: MapPoint | null;
  pathPoints: MapPoint[];
  addressLookup: AddressLookup | null;
  onAddressSearchStatusChange: (status: AddressSearchStatus) => void;
}) {
  const mapRef = useRef<google.maps.Map | null>(null);
  const [snappedPathBySource, setSnappedPathBySource] = useState<{ source: string; points: MapPoint[] } | null>(null);
  const [searchedPoint, setSearchedPoint] = useState<MapPoint | null>(null);
  const { isLoaded, loadError } = useJsApiLoader({
    id: "vehicle-history-google-map",
    googleMapsApiKey: apiKey,
  });
  const pathSource = useMemo(() => pathPoints.map((point) => `${point.lat.toFixed(6)},${point.lng.toFixed(6)}`).join("|"), [pathPoints]);

  useEffect(() => {
    if (!isLoaded || pathPoints.length < 2) {
      return;
    }

    let cancelled = false;
    const chunkSize = 24;
    const chunks: MapPoint[][] = [];

    for (let index = 0; index < pathPoints.length - 1; index += chunkSize - 1) {
      const chunk = pathPoints.slice(index, index + chunkSize);
      if (chunk.length >= 2) {
        chunks.push(chunk);
      }
      if (index + chunkSize >= pathPoints.length) break;
    }

    const routeChunk = async (chunk: MapPoint[]): Promise<MapPoint[]> => {
      const response = await fetch("/api/routes", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ points: chunk }),
      });

      if (!response.ok) {
        throw new Error(`Route API error ${response.status}`);
      }

      const payload = (await response.json()) as {
        encodedPolyline?: string;
        points?: MapPoint[];
      };

      if (payload.encodedPolyline) {
        return decodePolyline(payload.encodedPolyline);
      }

      return payload.points ?? chunk;
    };

    const buildSnappedPath = async () => {
      const joined: MapPoint[] = [];
      let atLeastOneChunkSnapped = false;

      for (let index = 0; index < chunks.length; index += 1) {
        const chunk = chunks[index];
        try {
          const segment = await routeChunk(chunks[index]);
          if (segment.length === 0) continue;
          atLeastOneChunkSnapped = true;
          if (joined.length === 0) {
            joined.push(...segment);
          } else {
            joined.push(...segment.slice(1));
          }
        } catch {
          // Fallback puntual por tramo para evitar perder todo el trazado.
          if (joined.length === 0) {
            joined.push(...chunk);
          } else {
            joined.push(...chunk.slice(1));
          }
        }
      }

      if (!cancelled && joined.length > 1) {
        if (atLeastOneChunkSnapped) {
          setSnappedPathBySource({ source: pathSource, points: joined });
        } else {
          setSnappedPathBySource({ source: pathSource, points: pathPoints });
        }
      }
    };

    void buildSnappedPath();

    return () => {
      cancelled = true;
    };
  }, [isLoaded, pathPoints, pathSource]);

  const visiblePath =
    snappedPathBySource?.source === pathSource && snappedPathBySource.points.length > 1
      ? snappedPathBySource.points
      : pathPoints;

  useEffect(() => {
    if (!isLoaded || !addressLookup || !addressLookup.query.trim()) {
      return;
    }

    let cancelled = false;
    onAddressSearchStatusChange({ status: "searching", message: "Buscando direccion..." });

    const geocoder = new window.google.maps.Geocoder();
    const doGeocode = ( request: google.maps.GeocoderRequest ) => new Promise<google.maps.GeocoderResult[]>( (resolve, reject) => {
      geocoder.geocode(request, (results, status) => {
        if(status === "OK") {
          resolve(results ?? [])
        }else if(status === "ZERO_RESULTS") {
          resolve([])
        }else{
          reject(status)
        }
      } )
    } )
    const run = async () => {
      const attemps: google.maps.GeocoderRequest[] = [
        {
          address: addressLookup.query,
          componentRestrictions: {
            locality: "Puente Alto",
            country: "CL"
          }
        },
        {
          address: addressLookup.query,
          componentRestrictions: {
            country: "CL"
          }
        },
        {
          address: addressLookup.query,
          region: "cl"
        }
      ]
      let results: google.maps.GeocoderResult[] = []
      try{
        for (const req of attemps) {
          if (cancelled) return;
          const res = await doGeocode(req)
          if(res.length) {
            results = res
            break
          }
        }
        if(cancelled) return;
        if(results.length && results[0].geometry?.location) {
          const location = results[0].geometry.location;
          const point = {
            lat: location.lat(),
            lng: location.lng()
          }
          setSearchedPoint(point)
          mapRef.current?.panTo(point)
          mapRef.current?.setZoom(16)
          onAddressSearchStatusChange({
            status: "found",
            message: results[0].formatted_address ?? "Dirección encontrada"
          })
          return;
        }
        onAddressSearchStatusChange({
          status: "not_found",
          message: "No se encontró la dirección deseada..."
        })
      } catch(e) {
        onAddressSearchStatusChange({
          status: "error",
          message: (e instanceof Error ? e.message : "Error de geocodificación")
        })
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [addressLookup, isLoaded, onAddressSearchStatusChange]);

  useEffect(() => {
    if (!isLoaded || !mapRef.current) {
      return;
    }

    if (visiblePath.length > 1) {
      const bounds = new window.google.maps.LatLngBounds();
      visiblePath.forEach((point) => bounds.extend(point));
      if (center) {
        bounds.extend(center);
      }
      mapRef.current.fitBounds(bounds, 24);
      return;
    }

    if (center) {
      mapRef.current.setCenter(center);
      mapRef.current.setZoom(14);
    }
  }, [center, isLoaded, visiblePath]);

  if (!apiKey) {
    return (
      <div className="map-frame">
        <div className="map-placeholder">
          <p>Falta GOOGLE_API_KEY en .env</p>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="map-frame">
        <div className="map-placeholder">
          <p>No se pudo cargar Google Maps.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="map-frame">
      {!isLoaded ? (
        <div className="map-placeholder">
          <p>Cargando mapa...</p>
        </div>
      ) : (
        <GoogleMap
          mapContainerClassName="google-map-root"
          center={center ?? { lat: -33.45, lng: -70.67 }}
          zoom={12}
          onLoad={(map) => {
            mapRef.current = map;
          }}
          options={{
            mapTypeControl: false,
            fullscreenControl: false,
            streetViewControl: false,
          }}
        >
          {center ? <MarkerF position={center} /> : null}
          {searchedPoint ? (
            <MarkerF
              position={searchedPoint}
              icon={{
                path: window.google.maps.SymbolPath.BACKWARD_CLOSED_ARROW,
                scale: 7,
                fillColor: "#1e88b0",
                fillOpacity: 1,
                strokeColor: "black",
                strokeWeight: 2,
              }}
            />
          ) : null}
          {visiblePath.length > 1 ? (
            <PolylineF
              path={visiblePath}
              options={{
                strokeColor: "#D63313",
                strokeOpacity: 0.9,
                strokeWeight: 3,
              }}
            />
          ) : null}
        </GoogleMap>
      )}
    </div>
  );
}

export function HistoryDashboard({ vehicles, googleMapsApiKey }: HistoryDashboardProps) {
  const firstVehicle = vehicles[0];
  const [selectedVehicleId, setSelectedVehicleId] = useState(firstVehicle?.id ?? "");
  const [selectedEventId, setSelectedEventId] = useState(firstVehicle?.events[0]?.id ?? "");
  const [isSwitchingVehicle, setIsSwitchingVehicle] = useState(false);
  const [eventFilter, setEventFilter] = useState<EventFilter>("all");
  const initialFrom = toDateAndTimeParts(firstVehicle?.periodStart ?? null);
  const initialTo = toDateAndTimeParts(firstVehicle?.periodEnd ?? null);
  const [fromDate, setFromDate] = useState(initialFrom.date);
  const [fromTime, setFromTime] = useState(initialFrom.time);
  const [toDate, setToDate] = useState(initialTo.date);
  const [toTime, setToTime] = useState(initialTo.time);
  const [addressInput, setAddressInput] = useState("");
  const [addressLookup, setAddressLookup] = useState<AddressLookup | null>(null);
  const [addressSearchStatus, setAddressSearchStatus] = useState<AddressSearchStatus>({ status: "idle" });
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const [pdfStatusMessage, setPdfStatusMessage] = useState<string | null>(null);

  const overallPeriod = useMemo(() => {
    const starts = vehicles
      .map((vehicle) => vehicle.periodStart)
      .filter((value): value is string => Boolean(value))
      .map((value) => Date.parse(value))
      .filter((value) => !Number.isNaN(value));
    const ends = vehicles
      .map((vehicle) => vehicle.periodEnd)
      .filter((value): value is string => Boolean(value))
      .map((value) => Date.parse(value))
      .filter((value) => !Number.isNaN(value));

    const minStart = starts.length ? new Date(Math.min(...starts)).toISOString() : null;
    const maxEnd = ends.length ? new Date(Math.max(...ends)).toISOString() : null;

    return { periodStart: minStart, periodEnd: maxEnd };
  }, [vehicles]);

  const selectedVehicle = useMemo(
    () => (selectedVehicleId === ALL_VEHICLES_ID ? null : vehicles.find((vehicle) => vehicle.id === selectedVehicleId) ?? vehicles[0]),
    [selectedVehicleId, vehicles],
  );

  const scopedVehicles = useMemo(() => (selectedVehicle ? [selectedVehicle] : vehicles), [selectedVehicle, vehicles]);

  const filteredEvents = useMemo(() => {
    const fromTs = parseFilterDateTime(fromDate, fromTime, "start");
    const toTs = parseFilterDateTime(toDate, toTime, "end");

    return scopedVehicles
      .flatMap((vehicle) => vehicle.events)
      .filter((event) => {
        if (eventFilter !== "all" && event.kind !== eventFilter) return false;
        if (fromTs !== null && event.startTimestamp !== null && event.startTimestamp < fromTs) return false;
        if (toTs !== null && event.startTimestamp !== null && event.startTimestamp > toTs) return false;
        return true;
      })
      .sort((a, b) => {
        const first = a.startTimestamp ?? 0;
        const second = b.startTimestamp ?? 0;
        return first - second;
      });
  }, [scopedVehicles, eventFilter, fromDate, fromTime, toDate, toTime]);

  const getFilteredEventsForVehicle = (vehicle: VehicleHistory): VehicleEvent[] => {
    const fromTs = parseFilterDateTime(fromDate, fromTime, "start");
    const toTs = parseFilterDateTime(toDate, toTime, "end");

    return vehicle.events
      .filter((event) => {
        if (eventFilter !== "all" && event.kind !== eventFilter) return false;
        if (fromTs !== null && event.startTimestamp !== null && event.startTimestamp < fromTs) return false;
        if (toTs !== null && event.startTimestamp !== null && event.startTimestamp > toTs) return false;
        return true;
      })
      .sort((a, b) => (a.startTimestamp ?? 0) - (b.startTimestamp ?? 0));
  };

  const selectedEvent = useMemo(
    () => filteredEvents.find((event) => event.id === selectedEventId) ?? filteredEvents[0] ?? null,
    [selectedEventId, filteredEvents],
  );

  const centerPoint = useMemo(() => {
    if (selectedEvent?.lat !== null && selectedEvent?.lat !== undefined && selectedEvent?.lon !== null && selectedEvent?.lon !== undefined) {
      return { lat: selectedEvent.lat, lng: selectedEvent.lon };
    }

    const firstWithCoordinates = filteredEvents.find((event) => event.lat !== null && event.lon !== null);
    if (!firstWithCoordinates || firstWithCoordinates.lat === null || firstWithCoordinates.lon === null) return null;
    return { lat: firstWithCoordinates.lat, lng: firstWithCoordinates.lon };
  }, [filteredEvents, selectedEvent]);

  const pathPoints = useMemo(() => buildPointsForRoute(filteredEvents), [filteredEvents]);

  const driveCount = filteredEvents.filter((event) => event.kind === "drive").length;
  const stopCount = filteredEvents.filter((event) => event.kind === "stop").length;
  const totalDistanceLabel = useMemo(() => {
    if (selectedVehicle) {
      return selectedVehicle.totalDistance ?? "-";
    }

    const sum = vehicles.reduce((acc, vehicle) => {
      const km = parseDistanceKilometers(vehicle.totalDistance);
      return km === null ? acc : acc + km;
    }, 0);
    return sum > 0 ? `${sum.toFixed(2)} Kilometer` : "-";
  }, [selectedVehicle, vehicles]);

  useEffect(() => {
    if (!isSwitchingVehicle) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setIsSwitchingVehicle(false);
    }, 250);

    return () => window.clearTimeout(timeoutId);
  }, [isSwitchingVehicle, selectedVehicleId]);

  const requestRouteForChunk = async (chunk: MapPoint[]): Promise<RoutesApiResponse> => {
    const response = await fetch("/api/routes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ points: chunk }),
    });

    if (!response.ok) {
      return {};
    }

    return (await response.json()) as RoutesApiResponse;
  };

  const chunkRoutePoints = (points: MapPoint[]): MapPoint[][] => {
    const chunkSize = 24;
    const chunks: MapPoint[][] = [];

    for (let index = 0; index < points.length - 1; index += chunkSize - 1) {
      const chunk = points.slice(index, index + chunkSize);
      if (chunk.length >= 2) {
        chunks.push(chunk);
      }
      if (index + chunkSize >= points.length) break;
    }
    return chunks;
  };

  const mapImageUrlToDataUrl = async (url: string): Promise<string | null> => {
    try {
      const response = await fetch(url);
      if (!response.ok) return null;
      const blob = await response.blob();

      return await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(typeof reader.result === "string" ? reader.result : null);
        reader.readAsDataURL(blob);
      });
    } catch {
      return null;
    }
  };

  const buildStaticMapDataUrl = async (points: MapPoint[]): Promise<string | null> => {
    const apiKey = googleMapsApiKey.trim();
    if (!apiKey || points.length < 2) return null;

    const chunks = chunkRoutePoints(points).slice(0, 4);
    const snappedPoints: MapPoint[] = [];
    let hasSnappedSegments = false;

    for (let index = 0; index < chunks.length; index += 1) {
      const payload = await requestRouteForChunk(chunks[index]);
      if (payload.encodedPolyline) {
        const decoded = decodePolyline(payload.encodedPolyline);
        if (decoded.length > 0) {
          hasSnappedSegments = true;
          if (snappedPoints.length === 0) {
            snappedPoints.push(...decoded);
          } else {
            snappedPoints.push(...decoded.slice(1));
          }
        }
      }
    }

    // Para PDF evitamos fallback a lineas rectas: si no hay trazado vial real, no renderizamos mapa.
    if (!hasSnappedSegments || snappedPoints.length < 2) {
      return null;
    }

    const sampledSnapped = compactRoutePoints(snappedPoints).slice(0, 80);
    if (sampledSnapped.length < 2) {
      return null;
    }

    const params = new URLSearchParams();
    // Static Maps (standard) soporta hasta 640x640 por request.
    params.set("size", "640x360");
    params.set("scale", "2");
    params.set("maptype", "roadmap");
    params.set("format", "png");
    params.set("key", apiKey);

    params.append(
      "path",
      `weight:4|color:0x101820ff|${sampledSnapped.map((p) => `${p.lat},${p.lng}`).join("|")}`,
    );

    params.append("markers", `color:green|label:I|${sampledSnapped[0].lat},${sampledSnapped[0].lng}`);
    const lastPoint = sampledSnapped[sampledSnapped.length - 1];
    params.append("markers", `color:red|label:F|${lastPoint.lat},${lastPoint.lng}`);

    let staticMapUrl = `https://maps.googleapis.com/maps/api/staticmap?${params.toString()}`;

    // Evita URLs muy largas que pueden provocar 400 en Static Maps.
    if (staticMapUrl.length > 7800) {
      const fallbackParams = new URLSearchParams();
      fallbackParams.set("size", "640x360");
      fallbackParams.set("scale", "2");
      fallbackParams.set("maptype", "roadmap");
      fallbackParams.set("format", "png");
      fallbackParams.set("key", apiKey);
      fallbackParams.append(
        "path",
        `weight:4|color:0x101820ff|${sampledSnapped.slice(0, 20).map((p) => `${p.lat},${p.lng}`).join("|")}`,
      );
      fallbackParams.append("markers", `color:green|label:I|${sampledSnapped[0].lat},${sampledSnapped[0].lng}`);
      fallbackParams.append("markers", `color:red|label:F|${lastPoint.lat},${lastPoint.lng}`);
      staticMapUrl = `https://maps.googleapis.com/maps/api/staticmap?${fallbackParams.toString()}`;
    }

    return mapImageUrlToDataUrl(staticMapUrl);
  };

  const handleGeneratePdf = async () => {
    setIsGeneratingPdf(true);
    setPdfStatusMessage("Generando reporte PDF...");

    try {
      const { jsPDF } = await import("jspdf");
      const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
      const reportVehicles = selectedVehicle ? [selectedVehicle] : vehicles;
      const rangeStart = `${fromDate || "-"} ${fromTime || "00:00"}`;
      const rangeEnd = `${toDate || "-"} ${toTime || "23:59"}`;

      for (let vehicleIndex = 0; vehicleIndex < reportVehicles.length; vehicleIndex += 1) {
        const vehicle = reportVehicles[vehicleIndex];
        const events = getFilteredEventsForVehicle(vehicle);
        const reportPathPoints = buildPointsForRoute(events);

        if (vehicleIndex > 0) {
          doc.addPage();
        }

        let y = 44;
        doc.setFontSize(16);
        doc.text("Reporte de rutas vehiculares", 40, y);
        y += 24;
        doc.setFontSize(12);
        doc.text(`Dispositivo: ${vehicle.name}`, 40, y);
        y += 18;
        doc.text(`Rango: ${rangeStart} - ${rangeEnd}`, 40, y);
        y += 18;
        doc.text(`Eventos: ${events.length} | Movimientos: ${events.filter((e) => e.kind === "drive").length} | Paradas: ${events.filter((e) => e.kind === "stop").length}`, 40, y);
        y += 18;
        doc.text(`Distancia total: ${vehicle.totalDistance ?? "-"}`, 40, y);
        y += 20;

        const mapImageData = await buildStaticMapDataUrl(reportPathPoints);
        if (mapImageData) {
          doc.addImage(mapImageData, "PNG", 40, y, 515, 265);
          y += 280;
        } else {
          doc.setFontSize(10);
          doc.text("No fue posible generar imagen de mapa para este vehiculo.", 40, y);
          y += 18;
        }

        doc.setFontSize(12);
        doc.text("Eventos (primeros 12):", 40, y);
        y += 16;
        doc.setFontSize(9);

        events.slice(0, 12).forEach((event, index) => {
          const line = `${index + 1}. ${event.kind === "drive" ? "Conducir" : "Detener"} | ${event.startAt} -> ${event.endAt} | ${event.distance}`;
          doc.text(line, 40, y);
          y += 14;
        });
      }

      const reportName = selectedVehicle ? selectedVehicle.name.replace(/\s+/g, "_") : "todos_los_dispositivos";
      doc.save(`reporte_rutas_${reportName}.pdf`);
      setPdfStatusMessage("PDF generado correctamente.");
    } catch {
      setPdfStatusMessage("No se pudo generar el PDF. Revisa la configuracion de Google API.");
    } finally {
      setIsGeneratingPdf(false);
    }
  };

  return (
    <div className="history-layout">
      <aside className="history-sidebar">
        <header className="sidebar-header">
          <h1>Historial</h1>
          <p>Movimientos y paradas por vehiculo</p>
        </header>

        <div className="panel-block">
          <label htmlFor="vehicle-select">Dispositivo:</label>
          <select
            id="vehicle-select"
            className="vehicle-select"
            value={selectedVehicleId}
            onChange={(event) => {
              const nextVehicleId = event.target.value;
              if (nextVehicleId === ALL_VEHICLES_ID) {
                setIsSwitchingVehicle(true);
                setSelectedVehicleId(ALL_VEHICLES_ID);
                setSelectedEventId("");
                const nextFrom = toDateAndTimeParts(overallPeriod.periodStart);
                const nextTo = toDateAndTimeParts(overallPeriod.periodEnd);
                setFromDate(nextFrom.date);
                setFromTime(nextFrom.time);
                setToDate(nextTo.date);
                setToTime(nextTo.time);
                return;
              }

              const nextVehicle = vehicles.find((vehicle) => vehicle.id === nextVehicleId);
              setIsSwitchingVehicle(true);
              setSelectedVehicleId(nextVehicleId);
              setSelectedEventId(nextVehicle?.events[0]?.id ?? "");
              const nextFrom = toDateAndTimeParts(nextVehicle?.periodStart ?? null);
              const nextTo = toDateAndTimeParts(nextVehicle?.periodEnd ?? null);
              setFromDate(nextFrom.date);
              setFromTime(nextFrom.time);
              setToDate(nextTo.date);
              setToTime(nextTo.time);
            }}
          >
            <option value={ALL_VEHICLES_ID}>Todos los dispositivos</option>
            {vehicles.map((vehicle) => (
              <option key={vehicle.id} value={vehicle.id}>
                {vehicle.name}
              </option>
            ))}
          </select>
        </div>

        <div className="panel-block filters-block">
          <label htmlFor="event-filter">Tipo de evento:</label>
          <select
            id="event-filter"
            className="vehicle-select"
            value={eventFilter}
            onChange={(event) => setEventFilter(event.target.value as EventFilter)}
          >
            <option value="all">Todos</option>
            <option value="drive">Solo movimiento</option>
            <option value="stop">Solo parada</option>
          </select>

          <label htmlFor="from-date">Fecha desde:</label>
          <input id="from-date" type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} />

          <label htmlFor="from-time">Hora desde:</label>
          <input id="from-time" type="time" value={fromTime} onChange={(event) => setFromTime(event.target.value)} />

          <label htmlFor="to-date">Fecha hasta:</label>
          <input id="to-date" type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} />

          <label htmlFor="to-time">Hora hasta:</label>
          <input id="to-time" type="time" value={toTime} onChange={(event) => setToTime(event.target.value)} />
        </div>

        <div className="panel-block filters-block">
          <label htmlFor="address-search">Buscar direccion:</label>
          <input
            id="address-search"
            type="text"
            placeholder="Ej: Av. Santa Rosa 1234, La Pintana"
            value={addressInput}
            onChange={(event) => setAddressInput(event.target.value)}
          />
          <button
            type="button"
            className="address-search-button"
            onClick={() => {
              const trimmed = addressInput.trim();
              if (!trimmed) {
                setAddressSearchStatus({ status: "not_found", message: "Escribe una direccion para buscar." });
                return;
              }

              setAddressLookup({ query: trimmed, token: Date.now() });
            }}
          >
            Centrar en direccion
          </button>
          {addressSearchStatus.status !== "idle" ? (
            <p className={`address-search-status ${addressSearchStatus.status}`}>{addressSearchStatus.message}</p>
          ) : null}
        </div>

        <div className="panel-block summary-grid">
          <div>
            <span>Total eventos</span>
            <strong>{filteredEvents.length}</strong>
          </div>
          <div>
            <span>Movimientos</span>
            <strong>{driveCount}</strong>
          </div>
          <div>
            <span>Paradas</span>
            <strong>{stopCount}</strong>
          </div>
          <div>
            <span>Distancia total</span>
            <strong>{totalDistanceLabel}</strong>
          </div>
        </div>

        <div className="panel-block period-block">
          <span>Desde: {(selectedVehicle?.periodStart ?? overallPeriod.periodStart) ?? "-"}</span>
          <span>Hasta: {(selectedVehicle?.periodEnd ?? overallPeriod.periodEnd) ?? "-"}</span>
        </div>

        {selectedVehicle?.error ? <p className="vehicle-error">{selectedVehicle.error}</p> : null}

        {isSwitchingVehicle ? (
          <div className="list-loader">
            <div className="loader-dot" />
            <p>Cargando historial del vehiculo...</p>
          </div>
        ) : null}

        <div className="events-list">
          {filteredEvents.map((event) => {
            const isSelected = selectedEvent?.id === event.id;
            return (
              <button
                key={event.id}
                type="button"
                className={`event-card ${event.kind} ${isSelected ? "active" : ""}`}
                onClick={() => setSelectedEventId(event.id)}
              >
                <div className="event-title">
                  <span className={`event-dot ${event.kind}`} />
                  <strong>
                    {event.index}. {event.kind === "drive" ? "Conducir" : "Detener"}
                  </strong>
                </div>
                {!selectedVehicle ? <p className="event-vehicle-tag">{event.vehicleName}</p> : null}
                <p>{event.startAt}</p>
                <p>{event.endAt}</p>
                <div className="event-metrics">
                  <span>Duracion: {event.duration}</span>
                  <span>Distancia: {event.distance}</span>
                </div>
              </button>
            );
          })}

          {!filteredEvents.length ? <p className="empty-events">Sin eventos para este filtro.</p> : null}
        </div>
      </aside>

      <section className="history-map-panel">
        <div className="map-toolbar">
          <div>
            <h2>{selectedVehicle?.name ?? "Todos los dispositivos"}</h2>
            <p>
              Velocidad maxima: {selectedVehicle?.maxSpeed ?? "-"} | Velocidad media: {selectedVehicle?.avgSpeed ?? "-"}
            </p>
          </div>
          <div className="toolbar-actions">
            <button type="button" className="report-button" onClick={handleGeneratePdf} disabled={isGeneratingPdf}>
              {isGeneratingPdf ? "Generando PDF..." : "Generar PDF"}
            </button>
            {selectedEvent?.googleMapsUrl ? (
              <a href={selectedEvent.googleMapsUrl} target="_blank" rel="noreferrer">
                Abrir en Google Maps
              </a>
            ) : null}
          </div>
        </div>
        {pdfStatusMessage ? <p className="pdf-status">{pdfStatusMessage}</p> : null}

        {isSwitchingVehicle ? (
          <div className="map-frame">
            <div className="map-placeholder">
              <p>Cargando vista del vehiculo...</p>
            </div>
          </div>
        ) : (
          <VehicleMap
            apiKey={googleMapsApiKey}
            center={centerPoint}
            pathPoints={pathPoints}
            addressLookup={addressLookup}
            onAddressSearchStatusChange={setAddressSearchStatus}
          />
        )}

        {selectedEvent ? (
          <div className="event-detail">
            <h3>Detalle del evento seleccionado</h3>
            <p>
              <strong>Estado:</strong> {selectedEvent.status}
            </p>
            <p>
              <strong>Vehiculo:</strong> {selectedEvent.vehicleName}
            </p>
            <p>
              <strong>Inicio:</strong> {selectedEvent.startAt}
            </p>
            <p>
              <strong>Fin:</strong> {selectedEvent.endAt}
            </p>
            <p>
              <strong>Duracion:</strong> {selectedEvent.duration}
            </p>
            <p>
              <strong>Distancia:</strong> {selectedEvent.distance}
            </p>
            <p>
              <strong>Velocidad maxima:</strong> {selectedEvent.speedMax}
            </p>
            <p>
              <strong>Velocidad media:</strong> {selectedEvent.speedAvg}
            </p>
            <p>
              <strong>Ubicacion:</strong> {stripHtml(selectedEvent.locationRaw) || "-"}
            </p>
          </div>
        ) : (
          <div className="event-detail">
            <h3>Detalle del evento seleccionado</h3>
            <p>No hay eventos disponibles para este vehiculo o para el filtro aplicado.</p>
          </div>
        )}
      </section>
    </div>
  );
}
