import { DataTypes, type QueryInterface } from "sequelize";

export const up = async ({ context: queryInterface }: { context: QueryInterface }) => {
  await queryInterface.createTable("assignments", {
    id: { type: DataTypes.UUID, primaryKey: true, allowNull: false },
    orderId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: "orders", key: "id" },
      onDelete: "CASCADE",
    },
    workerId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: "workers", key: "id" },
      onDelete: "CASCADE",
    },
    jurisdictionId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: "jurisdictions", key: "id" },
      onDelete: "CASCADE",
    },
    state: { type: DataTypes.STRING, allowNull: false, defaultValue: "dispatched" },
    source: { type: DataTypes.STRING, allowNull: false },
    score: { type: DataTypes.DECIMAL, allowNull: true },
    pipelineTrace: { type: DataTypes.JSONB, allowNull: true },
    overriddenBy: { type: DataTypes.STRING, allowNull: true },
    overrideReason: { type: DataTypes.TEXT, allowNull: true },
    dispatchedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    respondedAt: { type: DataTypes.DATE, allowNull: true },
    completedAt: { type: DataTypes.DATE, allowNull: true },
    expiresAt: { type: DataTypes.DATE, allowNull: true },
    createdAt: { type: DataTypes.DATE, allowNull: false },
    updatedAt: { type: DataTypes.DATE, allowNull: false },
  });

  await queryInterface.addIndex("assignments", ["workerId", "state"], {
    name: "assignments_worker_id_state",
  });
  await queryInterface.addIndex("assignments", ["orderId"], {
    name: "assignments_order_id",
  });
};

export const down = async ({ context: queryInterface }: { context: QueryInterface }) => {
  await queryInterface.dropTable("assignments");
};
