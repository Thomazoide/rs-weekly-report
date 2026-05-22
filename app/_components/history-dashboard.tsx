"use client";

import { GoogleMap, MarkerF, PolylineF, useJsApiLoader } from "@react-google-maps/api";
import { useEffect, useMemo, useRef, useState } from "react";

type EventKind = "drive" | "stop";
type EventFilter = "all" | EventKind;

type MapPoint = { lat: number; lng: number };

export type VehicleEvent = {
  id: string;
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

function stripHtml(value: string): string {
  return value.replace(/<[^>]*>/g, "").trim();
}

function toDatetimeLocalValue(raw: string | null): string {
  if (!raw) return "";
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return "";
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const day = String(parsed.getDate()).padStart(2, "0");
  const hours = String(parsed.getHours()).padStart(2, "0");
  const minutes = String(parsed.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function parseFilterDate(value: string): number | null {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? null : timestamp;
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

function VehicleMap({
  apiKey,
  center,
  pathPoints,
}: {
  apiKey: string;
  center: MapPoint | null;
  pathPoints: MapPoint[];
}) {
  const mapRef = useRef<google.maps.Map | null>(null);
  const [snappedPathBySource, setSnappedPathBySource] = useState<{ source: string; points: MapPoint[] } | null>(null);
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
          {visiblePath.length > 1 ? (
            <PolylineF
              path={visiblePath}
              options={{
                strokeColor: "#101820",
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
  const [eventFilter, setEventFilter] = useState<EventFilter>("all");
  const [fromDate, setFromDate] = useState(toDatetimeLocalValue(firstVehicle?.periodStart ?? null));
  const [toDate, setToDate] = useState(toDatetimeLocalValue(firstVehicle?.periodEnd ?? null));

  const selectedVehicle = useMemo(
    () => vehicles.find((vehicle) => vehicle.id === selectedVehicleId) ?? vehicles[0],
    [selectedVehicleId, vehicles],
  );

  const filteredEvents = useMemo(() => {
    const fromTs = parseFilterDate(fromDate);
    const toTs = parseFilterDate(toDate);

    return (selectedVehicle?.events ?? [])
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
  }, [selectedVehicle?.events, eventFilter, fromDate, toDate]);

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

  const pathPoints = useMemo(
    () => {
      const drivePoints = filteredEvents
        .filter((event) => event.kind === "drive" && event.lat !== null && event.lon !== null)
        .map((event) => ({ lat: event.lat as number, lng: event.lon as number }));

      const pointsToUse =
        drivePoints.length >= 2
          ? drivePoints
          : filteredEvents
              .filter((event) => event.lat !== null && event.lon !== null)
              .map((event) => ({ lat: event.lat as number, lng: event.lon as number }));

      return compactRoutePoints(pointsToUse);
    },
    [filteredEvents],
  );

  const driveCount = filteredEvents.filter((event) => event.kind === "drive").length;
  const stopCount = filteredEvents.filter((event) => event.kind === "stop").length;

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
            value={selectedVehicle?.id ?? ""}
            onChange={(event) => {
              const nextVehicleId = event.target.value;
              const nextVehicle = vehicles.find((vehicle) => vehicle.id === nextVehicleId);
              setSelectedVehicleId(nextVehicleId);
              setSelectedEventId(nextVehicle?.events[0]?.id ?? "");
              setFromDate(toDatetimeLocalValue(nextVehicle?.periodStart ?? null));
              setToDate(toDatetimeLocalValue(nextVehicle?.periodEnd ?? null));
            }}
          >
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

          <label htmlFor="from-date">Desde:</label>
          <input id="from-date" type="datetime-local" value={fromDate} onChange={(event) => setFromDate(event.target.value)} />

          <label htmlFor="to-date">Hasta:</label>
          <input id="to-date" type="datetime-local" value={toDate} onChange={(event) => setToDate(event.target.value)} />
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
            <strong>{selectedVehicle?.totalDistance ?? "-"}</strong>
          </div>
        </div>

        <div className="panel-block period-block">
          <span>Desde: {selectedVehicle?.periodStart ?? "-"}</span>
          <span>Hasta: {selectedVehicle?.periodEnd ?? "-"}</span>
        </div>

        {selectedVehicle?.error ? <p className="vehicle-error">{selectedVehicle.error}</p> : null}

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
            <h2>{selectedVehicle?.name ?? "Sin vehiculo"}</h2>
            <p>
              Velocidad maxima: {selectedVehicle?.maxSpeed ?? "-"} | Velocidad media: {selectedVehicle?.avgSpeed ?? "-"}
            </p>
          </div>
          {selectedEvent?.googleMapsUrl ? (
            <a href={selectedEvent.googleMapsUrl} target="_blank" rel="noreferrer">
              Abrir en Google Maps
            </a>
          ) : null}
        </div>

        <VehicleMap apiKey={googleMapsApiKey} center={centerPoint} pathPoints={pathPoints} />

        {selectedEvent ? (
          <div className="event-detail">
            <h3>Detalle del evento seleccionado</h3>
            <p>
              <strong>Estado:</strong> {selectedEvent.status}
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
        ) : null}
      </section>
    </div>
  );
}
