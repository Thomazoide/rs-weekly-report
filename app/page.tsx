import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { HistoryDashboard, type VehicleEvent, type VehicleHistory } from "./_components/history-dashboard";

type RawRow = {
  group_key?: string;
  status?: string;
  start_at?: string;
  end_at?: string;
  duration?: string;
  distance?: string;
  speed_max?: string;
  speed_avg?: string;
  location?: string;
};

type RawItem = {
  error?: string;
  meta?: {
    "device.name"?: {
      value?: string;
    };
  };
  table?: {
    rows?: RawRow[];
    totals?: {
      start?: { value?: string };
      end?: { value?: string };
      distance?: { value?: string };
      speed_max?: { value?: string };
      speed_avg?: { value?: string };
    };
  };
};

function parseCoordinates(location?: string): { lat: number; lon: number } | null {
  if (!location) {
    return null;
  }

  const match = location.match(/q=([-0-9.]+),([-0-9.]+)/);
  if (!match) {
    return null;
  }

  const lat = Number(match[1]);
  const lon = Number(match[2]);

  if (Number.isNaN(lat) || Number.isNaN(lon)) {
    return null;
  }

  return { lat, lon };
}

async function getVehicleHistories(): Promise<VehicleHistory[]> {
  const drivesDir = path.join(process.cwd(), "drives");
  const files = await readdir(drivesDir);
  const jsonFiles = files.filter((fileName) => fileName.endsWith(".json"));

  const vehicles = await Promise.all(
    jsonFiles.map(async (fileName) => {
      const absolutePath = path.join(drivesDir, fileName);
      const rawText = await readFile(absolutePath, "utf-8");
      const parsed = JSON.parse(rawText) as { items?: RawItem[] };

      const item = parsed.items?.[0] ?? {};
      const rows = item.table?.rows ?? [];
      const totals = item.table?.totals;
      const vehicleName = item.meta?.["device.name"]?.value ?? fileName.replace(".json", "");

      const events: VehicleEvent[] = rows.map((row, index) => {
        const coordinates = parseCoordinates(row.location);
        const eventKind: VehicleEvent["kind"] = row.group_key === "drive" ? "drive" : "stop";

        return {
          id: `${fileName}-${index}`,
          vehicleId: fileName.replace(".json", ""),
          vehicleName,
          index: index + 1,
          kind: eventKind,
          status: row.status ?? (eventKind === "drive" ? "En movimiento" : "Detenido"),
          startAt: row.start_at ?? "-",
          endAt: row.end_at ?? "-",
          startTimestamp: row.start_at ? Date.parse(row.start_at) : null,
          endTimestamp: row.end_at ? Date.parse(row.end_at) : null,
          duration: row.duration ?? "-",
          distance: row.distance ?? "-",
          speedMax: row.speed_max ?? "-",
          speedAvg: row.speed_avg ?? "-",
          locationRaw: row.location ?? "",
          lat: coordinates?.lat ?? null,
          lon: coordinates?.lon ?? null,
          googleMapsUrl:
            coordinates !== null
              ? `https://www.google.com/maps?q=${coordinates.lat},${coordinates.lon}`
              : null,
        };
      });

      return {
        id: fileName.replace(".json", ""),
        fileName,
        name: vehicleName,
        periodStart: totals?.start?.value ?? rows[0]?.start_at ?? null,
        periodEnd: totals?.end?.value ?? rows.at(-1)?.end_at ?? null,
        totalDistance: totals?.distance?.value ?? null,
        maxSpeed: totals?.speed_max?.value ?? null,
        avgSpeed: totals?.speed_avg?.value ?? null,
        error: item.error ?? null,
        events,
      } satisfies VehicleHistory;
    }),
  );

  return vehicles.sort((a, b) => a.name.localeCompare(b.name));
}

export default async function Home() {
  const vehicles = await getVehicleHistories();
  const googleMapsApiKey = process.env.GOOGLE_API_KEY ?? "";

  return <HistoryDashboard vehicles={vehicles} googleMapsApiKey={googleMapsApiKey} />;
}
