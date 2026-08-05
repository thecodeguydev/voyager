import { DataTypes, type QueryInterface } from "sequelize";

export const up = async ({ context: queryInterface }: { context: QueryInterface }) => {
  await queryInterface.createTable("zone_workers", {
    id: { type: DataTypes.UUID, primaryKey: true, allowNull: false },
    workerId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: "workers", key: "id" },
      onDelete: "CASCADE",
    },
    zoneId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: "zones", key: "id" },
      onDelete: "CASCADE",
    },
    createdAt: { type: DataTypes.DATE, allowNull: false },
    updatedAt: { type: DataTypes.DATE, allowNull: false },
  });

  await queryInterface.addIndex("zone_workers", ["workerId", "zoneId"], {
    unique: true,
    name: "zone_workers_worker_id_zone_id_unique",
  });
};

export const down = async ({ context: queryInterface }: { context: QueryInterface }) => {
  await queryInterface.dropTable("zone_workers");
};
