import { NextResponse } from "next/server";

type RoutePoint = { lat: number; lng: number };

type ComputeRoutesRequest = {
  points?: RoutePoint[];
};

function isValidPoint(value: unknown): value is RoutePoint {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<RoutePoint>;
  return typeof candidate.lat === "number" && typeof candidate.lng === "number";
}

export async function POST(request: Request) {
  let points: RoutePoint[] = [];

  try {
    const apiKey = process.env.GOOGLE_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        {
          points,
          warning: {
            code: "MISSING_API_KEY",
            message: "GOOGLE_API_KEY no configurada",
          },
        },
        { status: 200 },
      );
    }

    const body = (await request.json()) as ComputeRoutesRequest;
    points = Array.isArray(body.points) ? body.points.filter(isValidPoint) : [];

    if (points.length < 2) {
      return NextResponse.json({ points }, { status: 200 });
    }

    const origin = points[0];
    const destination = points[points.length - 1];
    const intermediates = points.slice(1, -1).map((point) => ({
      location: {
        latLng: {
          latitude: point.lat,
          longitude: point.lng,
        },
      },
    }));

    const response = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "routes.polyline.encodedPolyline",
      },
      body: JSON.stringify({
        origin: {
          location: {
            latLng: {
              latitude: origin.lat,
              longitude: origin.lng,
            },
          },
        },
        destination: {
          location: {
            latLng: {
              latitude: destination.lat,
              longitude: destination.lng,
            },
          },
        },
        intermediates,
        optimizeWaypointOrder: false,
        computeAlternativeRoutes: false,
        travelMode: "DRIVE",
        routingPreference: "TRAFFIC_UNAWARE",
        polylineQuality: "HIGH_QUALITY",
      }),
      cache: "no-store",
    });

    if (!response.ok) {
      const errorText = await response.text();
      return NextResponse.json(
        {
          points,
          warning: {
            code: "ROUTES_API_ERROR",
            message: "Error de Routes API",
            upstreamStatus: response.status,
            details: errorText,
          },
        },
        { status: 200 },
      );
    }

    const payload = (await response.json()) as {
      routes?: Array<{ polyline?: { encodedPolyline?: string } }>;
    };
    const encodedPolyline = payload.routes?.[0]?.polyline?.encodedPolyline;

    if (!encodedPolyline) {
      return NextResponse.json({ points }, { status: 200 });
    }

    return NextResponse.json({ encodedPolyline }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error inesperado";
    return NextResponse.json(
      {
        points,
        warning: {
          code: "INTERNAL_ERROR",
          message,
        },
      },
      { status: 200 },
    );
  }
}
