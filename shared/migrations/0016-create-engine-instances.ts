import { DataTypes, type QueryInterface } from "sequelize";

// engine_instances is a standalone liveness record (no FK to other tables) — see PLAN.md
// "engine_instances" and "Health checks". Backs GET /health/engine across the shared-DB boundary.
export const up = async ({ context: queryInterface }: { context: QueryInterface }) => {
  await queryInterface.createTable("engine_instances", {
    id: { type: DataTypes.UUID, primaryKey: true, allowNull: false },
    instanceId: { type: DataTypes.STRING, allowNull: false, unique: true },
    state: { type: DataTypes.STRING, allowNull: false, defaultValue: "healthy" },
    lastHeartbeatAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    claimedInFlight: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    startedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    version: { type: DataTypes.STRING, allowNull: true },
    createdAt: { type: DataTypes.DATE, allowNull: false },
    updatedAt: { type: DataTypes.DATE, allowNull: false },
  });
};

export const down = async ({ context: queryInterface }: { context: QueryInterface }) => {
  await queryInterface.dropTable("engine_instances");
};
