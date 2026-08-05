import { DataTypes, Model, type CreationOptional, type InferAttributes, type InferCreationAttributes, type Sequelize } from "sequelize";
import type { GeoJSONPoint, GeoJSONPolygon } from "./geo.js";
import { baseColumns, isInValidator } from "./base.js";

export type ZoneStatus = "active" | "inactive";
const ZONE_STATUSES: readonly ZoneStatus[] = ["active", "inactive"];

export class Zone extends Model<InferAttributes<Zone>, InferCreationAttributes<Zone>> {
  declare id: CreationOptional<string>;
  declare jurisdictionId: string;
  declare name: string;
  declare boundary: GeoJSONPolygon;
  declare centroid: GeoJSONPoint;
  declare status: CreationOptional<ZoneStatus>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

export function initZoneModel(sequelize: Sequelize): typeof Zone {
  Zone.init({
    ...baseColumns(),
    "jurisdictionId": {
      "type": DataTypes.UUID,
      "allowNull": false
    },
    "name": {
      "type": DataTypes.STRING,
      "allowNull": false
    },
    "boundary": {
      "type": DataTypes.GEOGRAPHY("POLYGON", 4326),
      "allowNull": false
    },
    "centroid": {
      "type": DataTypes.GEOGRAPHY("POINT", 4326),
      "allowNull": false
    },
    "status": {
      "type": DataTypes.STRING,
      "allowNull": false,
      "defaultValue": "active",
      "validate": isInValidator(ZONE_STATUSES),
    },
  }, {
    sequelize,
    "tableName": "zones",
    "modelName": "Zone"
  });
  
  return Zone;
}
