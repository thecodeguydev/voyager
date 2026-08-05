import { z } from "zod";
import type { GeoJSONPoint, GeoJSONPolygon } from "@voyager/shared";

export const pointInputSchema = z.object({ lng: z.number(), lat: z.number() });
export type PointInput = z.infer<typeof pointInputSchema>;

export const polygonInputSchema = z.object({
  // A closed ring: first and last point must match.
  points: z.array(pointInputSchema).min(4),
});
export type PolygonInput = z.infer<typeof polygonInputSchema>;

export function toGeoJSONPoint(input: PointInput): GeoJSONPoint {
  return { type: "Point", coordinates: [input.lng, input.lat] };
}

export function fromGeoJSONPoint(point: GeoJSONPoint | null | undefined): PointInput | null {
  if (!point) return null;
  return { lng: point.coordinates[0], lat: point.coordinates[1] };
}

export function toGeoJSONPolygon(input: PolygonInput): GeoJSONPolygon {
  return { type: "Polygon", coordinates: [input.points.map((p) => [p.lng, p.lat])] };
}

export function fromGeoJSONPolygon(polygon: GeoJSONPolygon | null | undefined): PolygonInput | null {
  if (!polygon) return null;
  return { points: polygon.coordinates[0].map(([lng, lat]) => ({ lng, lat })) };
}
