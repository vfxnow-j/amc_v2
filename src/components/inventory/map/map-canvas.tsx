"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import {
  LngLatBounds,
  Map as MapLibreMap,
  NavigationControl,
  Popup,
  type GeoJSONSource,
  type MapGeoJSONFeature,
  type MapMouseEvent,
} from "maplibre-gl";
import { useEffect, useRef, useState } from "react";
import { MAP_KINDS, type MapFeatureCollection } from "@/lib/map/types";
import {
  isDarkMode,
  resolveColors,
  watchAppearance,
  type ResolvedColors,
} from "./map-colors";

/**
 * The MapLibre canvas behind Inventory → Map. Client-only — MapScreen loads it
 * through `next/dynamic` with `ssr: false`, because MapLibre touches `window`
 * and WebGL at import.
 *
 * Tiles are OpenFreeMap (no key; it sees the viewer's map view, never client
 * data — the points are drawn from our own GeoJSON). The style swaps between
 * Positron and Dark with the app's mode, and the points re-tint from the app's
 * tokens whenever the theme changes, so all twelve themes read as one app.
 */

export type MapSelection = { placeIds: string[]; label: string } | null;

const STYLE_LIGHT = "https://tiles.openfreemap.org/styles/positron";
const STYLE_DARK = "https://tiles.openfreemap.org/styles/dark";

const SOURCE = "places";
const L_CLUSTER = "places-clusters";
const L_CLUSTER_COUNT = "places-cluster-count";
const L_POINT = "places-points";
const FONT = ["Noto Sans Regular"];

/** MapLibre's expression types aren't exported; the expressions are checked at runtime. */
const expr = (value: unknown) => value as never;

const CLUSTER_RADIUS = expr([
  "interpolate",
  ["linear"],
  ["sqrt", ["get", "weight"]],
  1,
  14,
  5,
  20,
  15,
  30,
  40,
  44,
]);

const POINT_RADIUS = expr([
  "interpolate",
  ["linear"],
  ["sqrt", ["max", ["get", "weight"], 1]],
  1,
  6,
  5,
  11,
  15,
  18,
]);

function kindColor(colors: ResolvedColors) {
  const pairs = MAP_KINDS.flatMap((kind) => [kind, colors[kind]]);
  return expr(["match", ["get", "kind"], ...pairs, colors.accent]);
}

function webglAvailable() {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

export default function MapCanvas({
  geojson,
  projection,
  weightNoun = "",
  onViewChange,
  onSelect,
}: {
  geojson: MapFeatureCollection;
  projection: "globe" | "mercator";
  /** "units" / "orders" — shown in the hover popup. */
  weightNoun?: string;
  onViewChange: (placeIds: string[]) => void;
  onSelect: (selection: MapSelection) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [unsupported, setUnsupported] = useState(false);

  // Latest props, read from inside MapLibre's handlers without re-creating the map.
  const geojsonRef = useRef(geojson);
  const projectionRef = useRef(projection);
  const weightNounRef = useRef(weightNoun);
  const onViewChangeRef = useRef(onViewChange);
  const onSelectRef = useRef(onSelect);
  useEffect(() => {
    weightNounRef.current = weightNoun;
    onViewChangeRef.current = onViewChange;
    onSelectRef.current = onSelect;
  });

  /* ── Create the map once ─────────────────────────────────────────────── */
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    if (!webglAvailable()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time capability probe on mount
      setUnsupported(true);
      return;
    }

    let colors = resolveColors();
    let dark = isDarkMode();
    let fitted = false;

    let map: MapLibreMap;
    try {
      map = new MapLibreMap({
        container,
        style: dark ? STYLE_DARK : STYLE_LIGHT,
        center: [-98, 38],
        zoom: projectionRef.current === "globe" ? 2.2 : 3,
        attributionControl: { compact: true },
        dragRotate: false,
        pitchWithRotate: false,
      });
    } catch {
      setUnsupported(true);
      return;
    }
    mapRef.current = map;
    map.addControl(new NavigationControl({ showCompass: false }), "top-right");
    map.touchZoomRotate.disableRotation();

    const reportView = () => {
      const features = geojsonRef.current.features;
      const globeWide =
        projectionRef.current === "globe" && map.getZoom() < 2;
      const bounds = map.getBounds();
      const ids = features
        .filter(
          (feature) =>
            globeWide ||
            bounds.contains(feature.geometry.coordinates as [number, number]),
        )
        .map((feature) => feature.properties.placeId);
      onViewChangeRef.current(ids);
    };

    const fitToData = () => {
      const features = geojsonRef.current.features;
      if (features.length === 0) return;
      const bounds = new LngLatBounds();
      for (const feature of features) {
        bounds.extend(feature.geometry.coordinates as [number, number]);
      }
      const span = bounds.getEast() - bounds.getWest();
      if (span > 60) {
        // Spread across continents: keep the whole-globe look, just turn it.
        map.jumpTo({ center: bounds.getCenter(), zoom: 1.6 });
      } else {
        map.fitBounds(bounds, { padding: 60, maxZoom: 9, duration: 0 });
      }
    };

    const paint = () => {
      if (!map.getLayer(L_POINT)) return;
      map.setPaintProperty(L_CLUSTER, "circle-color", colors.accent);
      map.setPaintProperty(L_CLUSTER, "circle-stroke-color", colors.panel);
      map.setPaintProperty(L_CLUSTER_COUNT, "text-color", colors.panel);
      map.setPaintProperty(L_POINT, "circle-color", kindColor(colors));
      map.setPaintProperty(L_POINT, "circle-stroke-color", colors.panel);
    };

    const addLayers = () => {
      map.setProjection({ type: projectionRef.current });
      if (!map.getSource(SOURCE)) {
        map.addSource(SOURCE, {
          type: "geojson",
          data: geojsonRef.current as GeoJSON.FeatureCollection,
          cluster: true,
          clusterRadius: 48,
          clusterMaxZoom: 12,
          clusterProperties: { weight: ["+", ["get", "weight"]] },
        });
      }
      if (!map.getLayer(L_CLUSTER)) {
        map.addLayer({
          id: L_CLUSTER,
          type: "circle",
          source: SOURCE,
          filter: ["has", "point_count"],
          paint: {
            "circle-color": colors.accent,
            "circle-opacity": 0.9,
            "circle-radius": CLUSTER_RADIUS,
            "circle-stroke-width": 2,
            "circle-stroke-color": colors.panel,
          },
        });
        map.addLayer({
          id: L_CLUSTER_COUNT,
          type: "symbol",
          source: SOURCE,
          filter: ["has", "point_count"],
          layout: {
            "text-field": expr(["to-string", ["get", "weight"]]),
            "text-font": FONT,
            "text-size": 12,
            "text-allow-overlap": true,
          },
          paint: { "text-color": colors.panel },
        });
        map.addLayer({
          id: L_POINT,
          type: "circle",
          source: SOURCE,
          filter: ["!", ["has", "point_count"]],
          paint: {
            "circle-color": kindColor(colors),
            "circle-radius": POINT_RADIUS,
            "circle-stroke-width": 1.5,
            "circle-stroke-color": colors.panel,
          },
        });
      }
      if (!fitted) {
        fitted = true;
        fitToData();
      }
      reportView();
    };

    map.on("style.load", addLayers);
    map.on("moveend", reportView);

    /* Clicks: a cluster opens to its places, a point to its own, empty map clears. */
    map.on("click", (event: MapMouseEvent) => {
      const layers = [L_CLUSTER, L_POINT].filter((id) => map.getLayer(id));
      const hit: MapGeoJSONFeature | undefined = layers.length
        ? map.queryRenderedFeatures(event.point, { layers })[0]
        : undefined;
      if (!hit) {
        onSelectRef.current(null);
        return;
      }
      if (hit.layer.id === L_POINT) {
        const props = hit.properties as { placeId: string; label: string };
        onSelectRef.current({ placeIds: [props.placeId], label: props.label });
        return;
      }
      const source = map.getSource<GeoJSONSource>(SOURCE);
      const clusterId = hit.properties.cluster_id as number;
      const center = (hit.geometry as GeoJSON.Point).coordinates as [
        number,
        number,
      ];
      if (!source) return;
      void source
        .getClusterLeaves(clusterId, Infinity, 0)
        .then((leaves) => {
          const placeIds = leaves.map(
            (leaf) => (leaf.properties as { placeId: string }).placeId,
          );
          onSelectRef.current({
            placeIds,
            label: `${placeIds.length} places`,
          });
        })
        .catch(() => undefined);
      void source
        .getClusterExpansionZoom(clusterId)
        .then((zoom) => map.easeTo({ center, zoom }))
        .catch(() => undefined);
    });

    /* Hover: pointer cursor, and a small popup on a point. */
    const popup = new Popup({
      closeButton: false,
      closeOnClick: false,
      offset: 12,
      className: "vfx-map-popup",
    });
    const enter = () => {
      map.getCanvas().style.cursor = "pointer";
    };
    const leave = () => {
      map.getCanvas().style.cursor = "";
      popup.remove();
    };
    map.on("mouseenter", L_CLUSTER, enter);
    map.on("mouseleave", L_CLUSTER, leave);
    map.on("mouseenter", L_POINT, enter);
    map.on("mouseleave", L_POINT, leave);
    map.on("mousemove", L_POINT, (event) => {
      const feature = event.features?.[0];
      if (!feature) return;
      const props = feature.properties as { label: string; weight: number };
      const node = document.createElement("div");
      const title = document.createElement("div");
      title.style.fontWeight = "700";
      title.textContent = props.label;
      const meta = document.createElement("div");
      meta.style.opacity = "0.7";
      meta.textContent = `${props.weight} ${weightNounRef.current}`.trim();
      node.append(title, meta);
      popup
        .setLngLat((feature.geometry as GeoJSON.Point).coordinates as [number, number])
        .setDOMContent(node)
        .addTo(map);
    });

    /* Theme or mode changed: re-tint, and swap the basemap on a light↔dark flip. */
    const unwatch = watchAppearance(() => {
      colors = resolveColors();
      const nextDark = isDarkMode();
      if (nextDark !== dark) {
        dark = nextDark;
        // style.load fires again and addLayers re-adds our source and layers.
        map.setStyle(dark ? STYLE_DARK : STYLE_LIGHT, { diff: false });
      } else {
        paint();
      }
    });

    const resize = new ResizeObserver(() => map.resize());
    resize.observe(container);

    return () => {
      unwatch();
      resize.disconnect();
      popup.remove();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  /* ── New data from the server (a filter changed) ─────────────────────── */
  useEffect(() => {
    geojsonRef.current = geojson;
    const map = mapRef.current;
    const source = map?.getSource<GeoJSONSource>(SOURCE);
    if (!map || !source) return;
    source.setData(geojson as GeoJSON.FeatureCollection);
    if (geojson.features.length > 0) {
      const bounds = new LngLatBounds();
      for (const feature of geojson.features) {
        bounds.extend(feature.geometry.coordinates as [number, number]);
      }
      if (bounds.getEast() - bounds.getWest() > 60) {
        map.easeTo({ center: bounds.getCenter(), zoom: 1.6 });
      } else {
        map.fitBounds(bounds, { padding: 60, maxZoom: 9 });
      }
    } else {
      map.fire("moveend");
    }
  }, [geojson]);

  /* ── Globe / flat ─────────────────────────────────────────────────────── */
  useEffect(() => {
    projectionRef.current = projection;
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    map.setProjection({ type: projection });
    map.fire("moveend");
  }, [projection]);

  if (unsupported) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-sunken p-6 text-center text-body text-ink-muted">
        This browser can&apos;t draw the map (WebGL is unavailable). The
        side panel and the Unplaced tab still list everything.
      </div>
    );
  }

  return (
    <>
      <style>{POPUP_CSS}</style>
      <div ref={containerRef} className="h-full w-full" />
    </>
  );
}

/** MapLibre's popup is white by default; give it the app's panel and ink. */
const POPUP_CSS = `
.vfx-map-popup .maplibregl-popup-content {
  background: var(--panel); color: var(--ink); border-radius: 10px;
  padding: 6px 10px; font-size: 12px; line-height: 1.35;
  box-shadow: 0 2px 10px rgb(0 0 0 / 0.18);
}
.vfx-map-popup.maplibregl-popup-anchor-top .maplibregl-popup-tip,
.vfx-map-popup.maplibregl-popup-anchor-top-left .maplibregl-popup-tip,
.vfx-map-popup.maplibregl-popup-anchor-top-right .maplibregl-popup-tip { border-bottom-color: var(--panel); }
.vfx-map-popup.maplibregl-popup-anchor-bottom .maplibregl-popup-tip,
.vfx-map-popup.maplibregl-popup-anchor-bottom-left .maplibregl-popup-tip,
.vfx-map-popup.maplibregl-popup-anchor-bottom-right .maplibregl-popup-tip { border-top-color: var(--panel); }
.vfx-map-popup.maplibregl-popup-anchor-left .maplibregl-popup-tip { border-right-color: var(--panel); }
.vfx-map-popup.maplibregl-popup-anchor-right .maplibregl-popup-tip { border-left-color: var(--panel); }
`;
