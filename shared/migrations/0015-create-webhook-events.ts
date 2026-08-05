import { DataTypes, type QueryInterface } from "sequelize";

export const up = async ({ context: queryInterface }: { context: QueryInterface }) => {
  await queryInterface.createTable("webhook_events", {
    id: { type: DataTypes.UUID, primaryKey: true, allowNull: false },
    sourceId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: "webhook_sources", key: "id" },
      onDelete: "CASCADE",
    },
    groupId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: "groups", key: "id" },
      onDelete: "CASCADE",
    },
    eventType: { type: DataTypes.STRING, allowNull: false },
    dedupeKey: { type: DataTypes.STRING, allowNull: false },
    signatureValid: { type: DataTypes.BOOLEAN, allowNull: false },
    payload: { type: DataTypes.JSONB, allowNull: false },
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: "received" },
    targetEntity: { type: DataTypes.STRING, allowNull: true },
    targetId: { type: DataTypes.UUID, allowNull: true },
    error: { type: DataTypes.TEXT, allowNull: true },
    receivedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    processedAt: { type: DataTypes.DATE, allowNull: true },
    createdAt: { type: DataTypes.DATE, allowNull: false },
    updatedAt: { type: DataTypes.DATE, allowNull: false },
  });

  await queryInterface.addIndex("webhook_events", ["sourceId", "dedupeKey"], {
    unique: true,
    name: "webhook_events_source_id_dedupe_key_unique",
  });
  await queryInterface.addIndex("webhook_events", ["status", "receivedAt"], {
    name: "webhook_events_status_received_at",
  });
};

export const down = async ({ context: queryInterface }: { context: QueryInterface }) => {
  await queryInterface.dropTable("webhook_events");
};
