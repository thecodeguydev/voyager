"use client";

import { useEffect, useMemo, useRef } from "react";
import { Map as MapLibreMap, NavigationControl, LngLatBounds, type StyleSpecification, type GeoJSONSource } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Feature, LineString } from "geojson";
import { useAssignments, useOrders, useWorkers } from "@/lib/hooks";
import { ACTIVE_ASSIGNMENT_STATES } from "@/lib/types";
import { EmptyState } from "@/components/ui/Card";

// Free, no-API-key raster basemap — see the "Map library" decision (MapLibre GL + OSM tiles).
const OSM_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "© OpenStreetMap contributors",
    },
  },
  layers: [{ id: "osm", type: "raster", source: "osm" }],
};

export function ActiveAssignmentsMap({ jurisdictionId }: { jurisdictionId?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);

  const { data: assignments } = useAssignments({ jurisdictionId });
  const { data: workers } = useWorkers(jurisdictionId);
  const { data: orders } = useOrders({ jurisdictionId });

  const links = useMemo(() => {
    if (!assignments || !workers || !orders) return [];
    const workerById = new Map(workers.map((w) => [w.id, w]));
    const orderById = new Map(orders.map((o) => [o.id, o]));
    return assignments
      .filter((a) => ACTIVE_ASSIGNMENT_STATES.includes(a.state))
      .map((a) => ({ assignment: a, worker: workerById.get(a.workerId), order: orderById.get(a.orderId) }))
      .filter((l) => l.worker?.location && l.order?.pickup);
  }, [assignments, workers, orders]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    mapRef.current = new MapLibreMap({
      container: containerRef.current,
      style: OSM_STYLE,
      center: [0, 20],
      zoom: 1.5,
      attributionControl: { compact: true },
    });
    mapRef.current.addControl(new NavigationControl({ showCompass: false }), "top-right");
    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const render = () => {
      const lineFeatures: Feature[] = links.map((l) => ({
        type: "Feature",
        properties: {},
        geometry: {
          type: "LineString",
          coordinates: [
            [l.worker!.location!.lng, l.worker!.location!.lat],
            [l.order!.pickup.lng, l.order!.pickup.lat],
          ],
        },
      }));
      const workerFeatures: Feature[] = links.map((l) => ({
        type: "Feature",
        properties: { kind: "worker" },
        geometry: { type: "Point", coordinates: [l.worker!.location!.lng, l.worker!.location!.lat] },
      }));
      const orderFeatures: Feature[] = links.map((l) => ({
        type: "Feature",
        properties: { kind: "order" },
        geometry: { type: "Point", coordinates: [l.order!.pickup.lng, l.order!.pickup.lat] },
      }));

      const lineSource = map.getSource("links") as GeoJSONSource | undefined;
      const pointSource = map.getSource("points") as GeoJSONSource | undefined;

      if (lineSource && pointSource) {
        lineSource.setData({ type: "FeatureCollection", features: lineFeatures });
        pointSource.setData({ type: "FeatureCollection", features: [...workerFeatures, ...orderFeatures] });
      } else {
        map.addSource("links", { type: "geojson", data: { type: "FeatureCollection", features: lineFeatures } });
        map.addSource("points", { type: "geojson", data: { type: "FeatureCollection", features: [...workerFeatures, ...orderFeatures] } });
        map.addLayer({ id: "links-line", type: "line", source: "links", paint: { "line-color": "#002ee5", "line-width": 2, "line-opacity": 0.6 } });
        map.addLayer({
          id: "points-circle",
          type: "circle",
          source: "points",
          paint: {
            "circle-radius": 6,
            "circle-stroke-width": 2,
            "circle-stroke-color": "#ffffff",
            "circle-color": ["match", ["get", "kind"], "worker", "#002ee5", "order", "#ff7a00", "#8a8a86"],
          },
        });
      }

      if (links.length > 0) {
        const bounds = new LngLatBounds();
        lineFeatures.forEach((f) => {
          const coords = (f.geometry as LineString).coordinates as [number, number][];
          coords.forEach((c) => bounds.extend(c));
        });
        map.fitBounds(bounds, { padding: 60, maxZoom: 12, duration: 0 });
      }
    };

    if (map.isStyleLoaded()) render();
    else map.once("load", render);
  }, [links]);

  const showEmpty = links.length === 0 && assignments && workers && orders;

  // The map container stays mounted even when there's nothing to show right now — live
  // polling regularly swings links.length between 0 and >0, and unmounting/remounting
  // containerRef would orphan the MapLibre instance (its creation effect only runs once
  // and bails out early if mapRef.current is already set, so a re-created container never
  // gets a new map). The empty message renders as an overlay instead of replacing the map.
  return (
    <div className="relative">
      <div ref={containerRef} className="h-80 w-full overflow-hidden rounded-lg" />
      {showEmpty && (
        <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-surface-card/90">
          <EmptyState title="No active dispatches with known locations" hint="Active assignments appear here once workers and orders both have coordinates." />
        </div>
      )}
      <div className="mt-2 flex gap-4 text-xs text-text-secondary">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ background: "#002ee5" }} /> Worker
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ background: "#ff7a00" }} /> Order pickup
        </span>
      </div>
    </div>
  );
}
