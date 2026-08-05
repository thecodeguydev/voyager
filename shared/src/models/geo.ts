/** GeoJSON shapes as returned/accepted by Sequelize for PostGIS GEOGRAPHY columns. */
export interface GeoJSONPoint {
  type: "Point";
  coordinates: [number, number];
}

export interface GeoJSONPolygon {
  type: "Polygon";
  coordinates: number[][][];
}
