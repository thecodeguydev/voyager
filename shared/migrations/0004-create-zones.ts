import { DataTypes, type QueryInterface } from "sequelize";

export const up = async ({ context: queryInterface }: { context: QueryInterface }) => {
  await queryInterface.createTable("zones", {
    id: { type: DataTypes.UUID, primaryKey: true, allowNull: false },
    jurisdictionId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: "jurisdictions", key: "id" },
      onDelete: "CASCADE",
    },
    name: { type: DataTypes.STRING, allowNull: false },
    boundary: { type: DataTypes.GEOGRAPHY("POLYGON", 4326), allowNull: false },
    centroid: { type: DataTypes.GEOGRAPHY("POINT", 4326), allowNull: false },
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: "active" },
    createdAt: { type: DataTypes.DATE, allowNull: false },
    updatedAt: { type: DataTypes.DATE, allowNull: false },
  });

  await queryInterface.addIndex("zones", ["boundary"], {
    name: "zones_boundary_gist",
    using: "gist",
  });
};

export const down = async ({ context: queryInterface }: { context: QueryInterface }) => {
  await queryInterface.dropTable("zones");
};
