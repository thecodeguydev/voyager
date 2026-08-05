import { DataTypes } from "sequelize";

/** The id/createdAt/updatedAt columns every model shares. */
export function baseColumns() {
  return {
    "id": { 
      "type": DataTypes.UUID, 
      "primaryKey": true, 
      "defaultValue": DataTypes.UUIDV4 
    },
    "createdAt": DataTypes.DATE,
    "updatedAt": DataTypes.DATE,
  };
}

/** Builds a Sequelize `isIn` validator restricting a STRING column to `values` (app-level enum). */
export function isInValidator<T extends string>(values: readonly T[]) {
  return { 
    "isIn": [values as readonly string[] as string[]] 
  };
}
