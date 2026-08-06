import { DataTypes, type QueryInterface } from "sequelize";

// The highest-volume table (one row per dispatch decision) — see PLAN.md "Telemetry / metric
// dictionaries". Partitioning by `ts` + retention is deferred to Phase 4; this is the plain
// table + the dashboard index it'll later be partitioned on top of.
export const up = async ({ context: queryInterface }: { context: QueryInterface }) => {
  await queryInterface.createTable("metric_points", {
    id: { type: DataTypes.UUID, primaryKey: true, allowNull: false },
    metricKey: { type: DataTypes.STRING, allowNull: false },
    jurisdictionId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: "jurisdictions", key: "id" },
      onDelete: "CASCADE",
    },
    workerId: {
      type: DataTypes.UUID,
      allowNull: true,
      references: { model: "workers", key: "id" },
      onDelete: "CASCADE",
    },
    orderId: {
      type: DataTypes.UUID,
      allowNull: true,
      references: { model: "orders", key: "id" },
      onDelete: "CASCADE",
    },
    value: { type: DataTypes.DECIMAL, allowNull: false },
    dimensions: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    ts: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    createdAt: { type: DataTypes.DATE, allowNull: false },
    updatedAt: { type: DataTypes.DATE, allowNull: false },
  });

  await queryInterface.addIndex("metric_points", ["metricKey", "jurisdictionId", "ts"], {
    name: "metric_points_key_jurisdiction_ts",
  });
};

export const down = async ({ context: queryInterface }: { context: QueryInterface }) => {
  await queryInterface.dropTable("metric_points");
};
