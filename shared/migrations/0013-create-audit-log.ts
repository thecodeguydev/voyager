import { DataTypes, type QueryInterface } from "sequelize";

export const up = async ({ context: queryInterface }: { context: QueryInterface }) => {
  await queryInterface.createTable("audit_log", {
    id: { type: DataTypes.UUID, primaryKey: true, allowNull: false },
    entity: { type: DataTypes.STRING, allowNull: false },
    entityId: { type: DataTypes.UUID, allowNull: false },
    // SET NULL (not CASCADE, unlike most FKs in this schema) — an audit trail must
    // survive deletion of the group/jurisdiction it records a change against.
    groupId: {
      type: DataTypes.UUID,
      allowNull: true,
      references: { model: "groups", key: "id" },
      onDelete: "SET NULL",
    },
    jurisdictionId: {
      type: DataTypes.UUID,
      allowNull: true,
      references: { model: "jurisdictions", key: "id" },
      onDelete: "SET NULL",
    },
    action: { type: DataTypes.STRING, allowNull: false },
    actor: { type: DataTypes.STRING, allowNull: false },
    reason: { type: DataTypes.TEXT, allowNull: true },
    before: { type: DataTypes.JSONB, allowNull: true },
    after: { type: DataTypes.JSONB, allowNull: true },
    createdAt: { type: DataTypes.DATE, allowNull: false },
    updatedAt: { type: DataTypes.DATE, allowNull: false },
  });

  await queryInterface.addIndex("audit_log", ["entity", "entityId"], {
    name: "audit_log_entity_entity_id",
  });
};

export const down = async ({ context: queryInterface }: { context: QueryInterface }) => {
  await queryInterface.dropTable("audit_log");
};
