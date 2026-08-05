import { DataTypes, type QueryInterface } from "sequelize";

export const up = async ({ context: queryInterface }: { context: QueryInterface }) => {
  await queryInterface.createTable("dispatch_queue", {
    id: { type: DataTypes.UUID, primaryKey: true, allowNull: false },
    orderId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: "orders", key: "id" },
      onDelete: "CASCADE",
    },
    jurisdictionId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: "jurisdictions", key: "id" },
      onDelete: "CASCADE",
    },
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: "pending" },
    claimedBy: { type: DataTypes.STRING, allowNull: true },
    claimedAt: { type: DataTypes.DATE, allowNull: true },
    attempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    nextAttemptAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
    lastError: { type: DataTypes.TEXT, allowNull: true },
    createdAt: { type: DataTypes.DATE, allowNull: false },
    updatedAt: { type: DataTypes.DATE, allowNull: false },
  });

  await queryInterface.addIndex("dispatch_queue", ["status", "nextAttemptAt"], {
    name: "dispatch_queue_status_next_attempt_at",
  });
};

export const down = async ({ context: queryInterface }: { context: QueryInterface }) => {
  await queryInterface.dropTable("dispatch_queue");
};
